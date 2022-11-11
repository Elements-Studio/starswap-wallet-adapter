import { MaybeHexString, Types } from 'aptos';
import {
  WalletAccountChangeError,
  WalletDisconnectionError,
  WalletGetNetworkError,
  WalletNetworkChangeError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletSignAndSubmitMessageError,
  WalletSignMessageError,
  WalletSignTransactionError
} from '../WalletProviders/errors';
import {
  AccountKeys,
  BaseWalletAdapter,
  NetworkInfo,
  scopePollingDetectionStrategy,
  SignMessagePayload,
  SignMessageResponse,
  WalletAdapterNetwork,
  WalletName,
  WalletReadyState
} from './BaseAdapter';
import { providers, utils, bcs } from '@starcoin/starcoin'
import { hexlify } from '@ethersproject/bytes'
import BigNumber from 'bignumber.js'
import { isConstructorDeclaration } from 'typescript';

interface ConnectStarcoinAccount {
  address: MaybeHexString;
  method: string;
  publicKey: MaybeHexString;
  status: number;
}

interface StarcoinAccount {
  address: MaybeHexString;
  publicKey?: MaybeHexString;
  authKey?: MaybeHexString;
  isConnected: boolean;
}
interface IStarcoinWallet {
  connect: () => Promise<ConnectStarcoinAccount>;
  account(): Promise<MaybeHexString>;
  publicKey(): Promise<MaybeHexString>;
  generateTransaction(sender: MaybeHexString, payload: any): Promise<any>;
  signAndSubmit(
    transaction: Types.TransactionPayload,
    options?: any
  ): Promise<{
    success: boolean;
    result: {
      hash: Types.HexEncodedBytes;
    };
  }>;
  isConnected(): Promise<boolean>;
  signTransaction(transaction: Types.TransactionPayload, options?: any): Promise<Uint8Array>;
  signMessage(message: SignMessagePayload): Promise<{
    success: boolean;
    result: SignMessageResponse;
  }>;
  disconnect(): Promise<void>;
  network(): Promise<NetworkInfo>;
  onAccountChange(listener: (address: string | undefined) => void): Promise<void>;
  onNetworkChange(listener: (network: NetworkInfo) => void): Promise<void>;
}

interface StarcoinWindow extends Window {
  starcoin?: any;
}

declare const window: StarcoinWindow;

export const StarcoinWalletName = 'Starcoin' as WalletName<'Starcoin'>;

export interface StarcoinWalletAdapterConfig {
  provider?: IStarcoinWallet;
  network?: WalletAdapterNetwork;
  timeout?: number;
}

export class StarcoinWalletAdapter extends BaseWalletAdapter {
  name = StarcoinWalletName;

  url = 'https://chrome.google.com/webstore/detail/starmask/mfhbebgoclkghebffdldpobeajmbecfk';

  icon =
    'https://lh3.googleusercontent.com/f4D8qy1-4es3Tyx_TUeeXM_VrYIqbRvZcFssWKwNZOW7CW595TzOpNX7p84xN7JoMzDxODfa-xOSCLsql0b16VssgA=w128-h128-e365-rj-sc0x00ffffff';

  protected _provider: IStarcoinWallet | undefined;

  protected _network: WalletAdapterNetwork;

  protected _chainId: string;

  protected _api: string;

  protected _timeout: number;

  protected _readyState: WalletReadyState =
    typeof window === 'undefined' || typeof document === 'undefined'
      ? WalletReadyState.Unsupported
      : WalletReadyState.NotDetected;

  protected _connecting: boolean;

  protected _wallet: StarcoinAccount | null;
  protected _nodeUrlMap: {[key: string]: string};

  constructor({
    // provider,
    // network = WalletAdapterNetwork.Testnet,
    timeout = 10000
  }: StarcoinWalletAdapterConfig = {}) {
    super();

    this._provider = typeof window !== 'undefined' ? window.starcoin : undefined;
    this._network = null;
    this._timeout = timeout;
    this._connecting = false;
    this._wallet = null;
    this._nodeUrlMap = {
      '1': 'https://main-seed.starcoin.org',
      '2': 'https://proxima-seed.starcoin.org',
      '251': 'https://barnard-seed.starcoin.org',
      '253': 'https://halley-seed.starcoin.org',
      '254': 'http://localhost:9850',
    }

    if (typeof window !== 'undefined' && this._readyState !== WalletReadyState.Unsupported) {
      scopePollingDetectionStrategy(() => {
        if (window.starcoin) {
          this._readyState = WalletReadyState.Installed;
          this.emit('readyStateChange', this._readyState);
          return true;
        }
        return false;
      });
    }
  }

  get publicAccount(): AccountKeys {
    return {
      publicKey: this._wallet?.publicKey || null,
      address: this._wallet?.address || null,
      authKey: this._wallet?.authKey || null
    };
  }

  get network(): NetworkInfo {
    return {
      name: this._network,
      api: this._api,
      chainId: this._chainId
    };
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return !!this._wallet?.isConnected;
  }

  get readyState(): WalletReadyState {
    return this._readyState;
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      if (
        !(
          this._readyState === WalletReadyState.Loadable ||
          this._readyState === WalletReadyState.Installed
        )
      )
        throw new WalletNotReadyError();
      this._connecting = true;

      const provider = this._provider || window.starcoin;
      const isConnected = await provider?.isConnected();

      if (isConnected) {
        // await provider?._handleDisconnect();
      }
      const newAccounts = await window.starcoin.request({
        method: 'stc_requestAccounts',
      })

      // const response = await provider?.connect();

      if (!newAccounts) {
        throw new WalletNotConnectedError('No connect response');
      }

      const walletAccount = newAccounts;
      // const publicKey = response.publicKey;
      if (walletAccount) {
        this._wallet = {
          address: walletAccount,
          // publicKey,
          isConnected: true
        };

        try {
          const networkInfo = await window.starcoin.request({
            method: 'chain.id',
          })
          this._network = networkInfo.id;
          this._chainId = `0x${networkInfo.id.toString(16)}`;
          // this._api = networkInfo.api;
        } catch (error: any) {
          const errMsg = error.message;
          this.emit('error', new WalletGetNetworkError(errMsg));
          throw error;
        }
      }

      this.emit('connect', this._wallet?.address || '');
    } catch (error: any) {
      this.emit('error', new Error('User has rejected the connection'));
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    // const wallet = this._wallet;
    // const provider = this._provider || window.starcoin;
    // if (wallet) {
    //   this._wallet = null;

    //   try {
    //     await provider?.disconnect();
    //   } catch (error: any) {
    //     this.emit('error', new WalletDisconnectionError(error?.message, error));
    //   }
    // }

    // this.emit('disconnect');
    throw new Error('No Disconnect');
  }

  async signTransaction(
    transactionPyld: any,
    options?: any
  ): Promise<any> {
    try {
      // const wallet = this._wallet;
      // const provider = this._provider || window.starcoin;
      // if (!wallet || !provider) throw new WalletNotConnectedError();
      // const response = await provider?.getSigner().signTransaction(transactionPyld, options);

      // return response as Uint8Array;

      const wallet = this._wallet;
      const provider = this._provider || window.starcoin;
      if (!wallet || !provider) throw new WalletNotConnectedError();

      const functionId = '0x1::TransferScripts::peer_to_peer_v2';
      const strTypeArgs = ['0x1::STC::STC'];
      const toAccount = transactionPyld.arguments[0];

      if (!toAccount) {
        window.alert('Invalid To: can not be empty!')
        return false
      }
      const sendAmount = parseFloat(transactionPyld.arguments[1]);
      if (sendAmount <= 0) {
        // eslint-disable-next-line no-alert
        window.alert('Invalid sendAmount: should be a number!')
        return false
      }
      const BIG_NUMBER_NANO_STC_MULTIPLIER = new BigNumber('1000000000');
      const sendAmountSTC = new BigNumber(String(sendAmount), 10);
      const sendAmountNanoSTC = sendAmountSTC.times(
        BIG_NUMBER_NANO_STC_MULTIPLIER
      );
      const args = [toAccount, sendAmountNanoSTC]
      const nodeUrl = this._nodeUrlMap[window.starcoin.networkVersion]
      const scriptFunction = await utils.tx.encodeScriptFunctionByResolve(
        functionId,
        strTypeArgs,
        args,
        nodeUrl
      );

      const payloadInHex = (function () {
        const se = new bcs.BcsSerializer()
        scriptFunction.serialize(se)
        return hexlify(se.getBytes())
      })()
      const txParams = {
        data: payloadInHex,
      }

      const transactionHash = await new providers.Web3Provider(window.starcoin, 'any') 
        .getSigner()
        .sendUncheckedTransaction(txParams)
  
      // const response = await provider?.signAndSubmit(transactionPyld, options);

      if (!transactionHash) {
        throw new Error('No response');
      }
      return transactionHash;
    } catch (error: any) {
      this.emit('error', new WalletSignTransactionError(error));
      throw error;
    }
  }

  async signAndSubmitTransaction(
    transactionPyld: any,
    options?: any
  ): Promise<{ hash: Types.HexEncodedBytes }> {
    try {
      const wallet = this._wallet;
      const provider = this._provider || window.starcoin;
      if (!wallet || !provider) throw new WalletNotConnectedError();

      const functionId = '0x1::TransferScripts::peer_to_peer_v2';
      const strTypeArgs = ['0x1::STC::STC'];
      const toAccount = transactionPyld.arguments[0];
      const sendAmount = parseFloat(transactionPyld.arguments[1]);
      const BIG_NUMBER_NANO_STC_MULTIPLIER = new BigNumber('1000000000');
      const sendAmountSTC = new BigNumber(String(sendAmount), 10);
      const sendAmountNanoSTC = sendAmountSTC.times(
        BIG_NUMBER_NANO_STC_MULTIPLIER
      );
      const args = [toAccount, sendAmountNanoSTC]
      const nodeUrl = this._nodeUrlMap[window.starcoin.networkVersion]
      const scriptFunction = await utils.tx.encodeScriptFunctionByResolve(
        functionId,
        strTypeArgs,
        args,
        nodeUrl
      );

      const payloadInHex = (function () {
        const se = new bcs.BcsSerializer()
        scriptFunction.serialize(se)
        return hexlify(se.getBytes())
      })()
      const txParams = {
        data: payloadInHex,
      }

      const transactionHash = await new providers.Web3Provider(window.starcoin, 'any') 
        .getSigner()
        .sendUncheckedTransaction(txParams)
  
      // const response = await provider?.signAndSubmit(transactionPyld, options);

      if (!transactionHash) {
        throw new Error('No response');
      }
      return { hash: transactionHash };
    } catch (error: any) {
      this.emit('error', new WalletSignAndSubmitMessageError(error.message));
      throw error;
    }
  }

  async signMessage(messagePayload: any): Promise<any> {
    try {
      // const response = await provider?.getSigner().signMessage(messagePayload);
      throw new Error('Sign Message failed');
    } catch (error: any) {
      const errMsg = error.message;
      this.emit('error', new WalletSignMessageError(errMsg));
      throw error;
    }
  }

  async onAccountChange(): Promise<void> {
    try {
      const wallet = this._wallet;
      const provider = this._provider || window.starcoin;
      if (!wallet || !provider) throw new WalletNotConnectedError();
      const handleAccountChange = async (newAccount: string | undefined) => {
        // disconnect wallet if newAccount is undefined
        // if (newAccount === undefined) {
        //   // if (this.connected) {
        //   //   await provider?.disconnect();
        //   // }
        //   return;
        // }
        // const newPublicKey = await provider?.publicKey();
        this._wallet = {
          ...this._wallet,
          address: newAccount,
          // publicKey: newPublicKey
        };
        this.emit('accountChange', newAccount);
      };
      await provider?.on('accountsChanged', handleAccountChange)
    } catch (error: any) {
      const errMsg = error.message;
      this.emit('error', new WalletAccountChangeError(errMsg));
      throw error;
    }
  }

  async onNetworkChange(): Promise<void> {
    try {
      const wallet = this._wallet;
      const provider = this._provider || window.starcoin;
      if (!wallet || !provider) throw new WalletNotConnectedError();
      const handleNetworkChange = (network: WalletAdapterNetwork) => {
        this._network = network;
        // this._api = network.api;
        // this._chainId = network.chainId;
        this.emit('networkChange', this._network);
      };
      await provider?.on('networkChanged', handleNetworkChange)
    } catch (error: any) {
      const errMsg = error.message;
      this.emit('error', new WalletNetworkChangeError(errMsg));
      throw error;
    }
  }
}
