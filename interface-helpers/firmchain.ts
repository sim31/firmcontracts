import { Confirmer, ConfirmerOp, ConfirmerOpId } from './types'

export function createAddConfirmerOps(confs: Confirmer[]): ConfirmerOp[] {
  return confs.map(conf => { return {opId:  ConfirmerOpId.Add, conf} });
}
