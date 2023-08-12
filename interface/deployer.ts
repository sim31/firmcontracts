import { ethers, BytesLike } from 'ethers';
import * as factoryInfo from '@zoltu/deterministic-deployment-proxy/output/deployment.json';
import { AccountSystemImpl, AccountSystemImpl__factory, AddressStr, FirmChainAbi, FirmChainAbi__factory, FirmChainImpl, FirmChainImpl__factory, ZeroId } from './types';
import { normalizeHexStr } from './abi';
import { Filesystem, Filesystem__factory } from '../typechain-types';

export class DependencyMissing extends Error {
  constructor(contractName: string, address: string) {
    super(`Dependency not deployed: ${contractName}. Address: ${address}`);
  }
};

export class Deployer {
  private _provider: ethers.providers.JsonRpcProvider;
  private _signer: ethers.providers.JsonRpcSigner;
  private _factoryDeployed: boolean = false;

  constructor(provider: ethers.providers.JsonRpcProvider) {
    this._provider = provider;
    this._signer = provider.getSigner(0);
  }

  /**
   * @param noDeploy - won't try to deploy required smart contracts in case they are missing.
   * Use this when you expect the required smart contracts to already exist in the underlying chain
   */
  async init(noDeploy?: boolean) {
    if (this._factoryDeployed) {
      return;
    }

    const addr = normalizeHexStr("0x" + factoryInfo.address);

    if (await this.contractExists(addr)) {
      this._factoryDeployed = true;
      console.log("Factory exists: ", addr);
    } else if (!noDeploy) {
      await this._deployDetFactory();
    } else {
      throw new DependencyMissing("Deterministic factor", factoryInfo.address);
    }
  }

  getProvider() {
    return this._provider;
  }

  getSigner() {
    return this._signer;
  }

  isReady() {
    return this._factoryDeployed;
  }

  getFactoryAddress() {
    return '0x' + factoryInfo.address;
  }

  getFactoryDeploymentTx() {
    return factoryInfo;
  }

  async contractExists(address: AddressStr): Promise<boolean> {
    const code = await this._provider.getCode(address); 
    return code !== '0x';
  }

  getDetAddress(bytecode: BytesLike) {
    const initCodeHash = ethers.utils.keccak256(bytecode ?? '0x00');
    const expAddr = normalizeHexStr(ethers.utils.getCreate2Address(factoryInfo.address, ZeroId, initCodeHash));
    return expAddr;
  }

  /**
   * @param noDeploy - won't try to deploy required smart contracts in case they are missing.
   * Use this when you expect the required smart contracts to already exist in the underlying chain
   */
  async detDeployContract(bytecode: BytesLike, name: string, noDeploy?: boolean): Promise<AddressStr> {
    if (!this._factoryDeployed) {
      throw new Error('Factory has to be deployed first');
    }

    const expAddr = this.getDetAddress(bytecode);

    if (await this.contractExists(expAddr)) {
      console.log(`Contract ${name} exists: ${expAddr}`);
      return expAddr;
    } else if (!noDeploy) {
      // const addr = normalizeHexStr(await this._provider.call({
      //   to: factoryInfo.address, data: bytecode, gasLimit: 10552000
      // }));

      const resp = await this._signer.sendTransaction({
        to: factoryInfo.address, data: bytecode, gasLimit: 10552000
      });
      await resp.wait();

      if (await this._provider.getCode(expAddr) === '0x') {
        throw new Error( 'Failed to set code');
      }

      // if (addr !== expAddr) {
      //   throw new Error('Address unexpected')
      // }

      console.log(`Contract "${name}" deployed: ${expAddr}`);

      return expAddr;
    } else {
      throw new DependencyMissing(name, expAddr);
    }
  }

  private async _deployDetFactory() {
    const response = await this._signer.sendTransaction({
      to: "0x" + factoryInfo.signerAddress,
      value: "0x" + factoryInfo.gasPrice * factoryInfo.gasLimit,
    });
    await response.wait();
    // console.log("receipt: ", receipt);
    // console.log("balance: ", await ethers.provider.getBalance("0x" + detFactory.signerAddress));
    
    const tx = await this._provider.sendTransaction(
      "0x" + factoryInfo.transaction
    );
    // console.log("ok");
    await tx.wait();

    this._factoryDeployed = true;
    console.log("Factory deployed: ", '0x' + factoryInfo.address);
  }
}

export class FirmContractDeployer extends Deployer {
  constructor(provider: ethers.providers.JsonRpcProvider) {
    super(provider);
  }

  async deployAbi(noDeploy?: boolean) {
    const factory = new FirmChainAbi__factory(this.getSigner());
    const bytecode = await factory.getDeployTransaction().data;

    const addr = await this.detDeployContract(bytecode ?? '', 'FirmChainAbi', noDeploy);

    return factory.attach(addr);
  }

  async deployFirmChainImpl(abiContr: FirmChainAbi, noDeploy?: boolean) {
    const factory = new FirmChainImpl__factory({
      ["contracts/FirmChainAbi.sol:FirmChainAbi"]: abiContr.address
    }, this.getSigner());

    const bytecode = await factory.getDeployTransaction().data;

    const addr = await this.detDeployContract(bytecode ?? '', 'FirmChainImpl', noDeploy);

    return factory.attach(addr);
  }

  async deployAccountSystemImpl(noDeploy?: boolean) {
    const factory = new AccountSystemImpl__factory(this.getSigner());

    const bytecode = await factory.getDeployTransaction().data;
    const addr = await this.detDeployContract(bytecode ?? '', 'AccountSystemImpl', noDeploy);

    return factory.attach(addr);
  }

  async deployFilesystem(noDeploy?: boolean) {
    const factory = new Filesystem__factory(this.getSigner());

    const bytecode = await factory.getDeployTransaction().data;
    const addr = await this.detDeployContract(bytecode ?? '', 'Filesystem', noDeploy);

    return factory.attach(addr);
  }
}
