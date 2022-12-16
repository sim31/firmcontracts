import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";


const config: HardhatUserConfig = {
  // networks: {
  //   hardhat: {
  //     allowUnlimitedContractSize: true
  //   }
  // },
  // gasReporter: {
  //   enabled: true,
  // },
  solidity: "0.8.17",
};

export default config;
