/// <reference path="../../types/ipfs-http-client.d.ts" />
import { create } from 'ipfs-http-client';
import { getIpfsConfiguration } from '../../config/env';

let ipfsClient: any;

function getIpfsClient() {
  if (!ipfsClient) {
    ipfsClient = create(getIpfsConfiguration());
  }

  return ipfsClient;
}

export { getIpfsClient };
