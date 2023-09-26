import path from 'path'
import fs, { readFileSync } from 'fs'
import { BigNumber } from 'bignumber.js'
import { UserSigner } from '@multiversx/sdk-wallet'
import { chunkArray, getArg, timeout } from './shared/helpers'
import { SnapshotCandidate, SnapshotMember } from './shared/types'
import { ApiNetworkProvider, ProxyNetworkProvider } from '@multiversx/sdk-network-providers'
import {
  Account,
  Address,
  Transaction,
  AddressValue,
  BigUIntValue,
  ContractFunction,
  ContractCallPayloadBuilder,
} from '@multiversx/sdk-core'

const AdminPem = 'admin.pem'
const MaxBlockGasLimit = 600_000_000

const main = async () => {
  const env = getArg(0)
  const mxpyConfig = await loadMxpyConfig()
  const apiUrl = mxpyConfig[env]['api']
  const proxyUrl = mxpyConfig[env]['proxy']
  const itheumTokenId = mxpyConfig[env]['itheum-tokenid']
  const itheumMinHoldAmount = +mxpyConfig[env]['itheum-min-hold-amount']
  const trailblazerNftId = mxpyConfig[env]['trailblazer-nftid']
  const scAddress = mxpyConfig[env]['contract-address']

  if (!env || !itheumTokenId || !trailblazerNftId || !scAddress || !apiUrl || !proxyUrl) {
    console.log(`Invalid '${env}' config`)
    return
  }

  const apiProvider = new ApiNetworkProvider(apiUrl, { timeout: 30000 })
  const proxyProvider = new ProxyNetworkProvider(proxyUrl, { timeout: 30000 })
  const itheumTokenDefinition = await apiProvider.getDefinitionOfFungibleToken(itheumTokenId)

  let members: SnapshotMember[] = []
  let seenAddresses = new Set<string>()

  console.log(`Scanning ITHEUM token holders with minimum ${itheumMinHoldAmount} $ITHEUM ...`)

  for (let page = 1; page <= 10; page++) {
    const paginatedCandidates = await getPaginatedTokenAccounts(apiProvider, itheumTokenId, page)

    if (paginatedCandidates.length === 0) {
      break
    }

    paginatedCandidates
      .map((candidate) => ({
        address: candidate.address,
        weight: candidate.balance,
      }))
      .forEach((member) => {
        const satisfiesMinHoldAmount = new BigNumber(member.weight).shiftedBy(-itheumTokenDefinition.decimals).gte(itheumMinHoldAmount)
        if (!seenAddresses.has(member.address) && satisfiesMinHoldAmount) {
          seenAddresses.add(member.address)
          members.push(member)
        }
      })

    await timeout(500)
  }

  console.log('ITHEUM token snapshot completed!')

  console.log('Scanning Trailblazer SFT holders ...')

  for (let page = 1; page <= 10; page++) {
    const paginatedCandidates = await getPaginatedSftAccounts(apiProvider, trailblazerNftId, page)

    if (paginatedCandidates.length === 0) {
      break
    }

    paginatedCandidates
      .map((candidate) => ({
        address: candidate.address,
        weight: candidate.balance,
      }))
      .forEach((member) => {
        if (!seenAddresses.has(member.address)) {
          seenAddresses.add(member.address)
          members.push(member)
        }
      })

    await timeout(500)
  }

  console.log(`${members.length} have been included in the snapshot.`)

  console.log('Registering snapshot batches in smart contract ...')

  const batches = chunkArray(members, 500)

  const signer = await getAdminSigner()
  const account = new Account(signer.getAddress())
  const accountOnNetwork = await apiProvider.getAccount(account.address)
  account.update(accountOnNetwork)

  for (let i = 0; i < batches.length; i++) {
    const chunk = batches[i]
    console.log(`Registering members batch ${i + 1} of ${batches.length} ...`)
    await registerSnapshotInContract(proxyProvider, account, signer, scAddress, chunk)
    await timeout(500)
  }

  console.log(`Done! Snapshot of total ${members.length} members registered!`)
}

export const loadMxpyConfig = async () => {
  const storagePath = path.join(__dirname, '..', 'mxpy.data-storage.json')
  const storageContents = readFileSync(storagePath, { encoding: 'utf8' })
  return JSON.parse(storageContents)
}

const getPaginatedTokenAccounts = async (provider: ApiNetworkProvider, tokenId: string, page: number): Promise<SnapshotCandidate[]> => {
  const perPage = 1000
  const from = (page - 1) * perPage
  return await provider.doGetGeneric(`tokens/${tokenId}/accounts?from=${from}&size=${perPage}`)
}

const getPaginatedSftAccounts = async (provider: ApiNetworkProvider, nftId: string, page: number): Promise<SnapshotCandidate[]> => {
  const perPage = 1000
  const from = (page - 1) * perPage
  return await provider.doGetGeneric(`nfts/${nftId}/accounts?includeFlagged=true&from=${from}&size=${perPage}`)
}

const getAdminSigner = async () => {
  const pemWalletPath = path.join(__dirname, '..', 'wallets', AdminPem)
  const pemWalletContents = await fs.promises.readFile(pemWalletPath, {
    encoding: 'utf8',
  })
  return UserSigner.fromPem(pemWalletContents)
}

const registerSnapshotInContract = async (
  provider: ProxyNetworkProvider,
  account: Account,
  signer: UserSigner,
  scAddress: string,
  entries: SnapshotMember[]
) => {
  const networkConfig = await provider.getNetworkConfig()

  const payload = entries
    .reduce((carry, entry) => {
      return carry.addArg(new AddressValue(Address.fromBech32(entry.address))).addArg(new BigUIntValue(entry.weight))
    }, new ContractCallPayloadBuilder().setFunction(new ContractFunction('registerMembersSnapshotBatch')))
    .build()

  const computedGasLimit = Math.min(MaxBlockGasLimit, 20_000_000 + (networkConfig.GasPerDataByte + 20_000) * payload.length())

  const tx = new Transaction({
    data: payload,
    gasLimit: computedGasLimit,
    receiver: new Address(scAddress),
    value: 0,
    sender: account.address,
    chainID: networkConfig.ChainID,
  })

  tx.setNonce(account.getNonceThenIncrement())
  const signature = await signer.sign(tx.serializeForSigning())
  tx.applySignature(signature)

  await provider.sendTransaction(tx)

  return tx
}

main()
