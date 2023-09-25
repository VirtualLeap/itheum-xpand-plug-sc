NETWORK_NAME="devnet" # devnet, testnet, mainnet
ADMIN_PEM="wallets/admin.pem"

CONTRACT_ADDRESS=$(mxpy data load --partition $NETWORK_NAME --key=contract-address)
ADMIN_ADDRESS=$(mxpy data load --partition $NETWORK_NAME --key=admin-address)
PROXY=$(mxpy data load --partition $NETWORK_NAME --key=proxy)
CHAIN_ID=$(mxpy data load --partition $NETWORK_NAME --key=chain-id)

generateAdminKeys() {
  mkdir -p wallets
  cd wallets
  mxpy wallet new --format pem --outfile admin.pem
  admin_pem_address=$(mxpy wallet pem-address admin.pem)
  cd ..
  echo "admin address: $admin_pem_address"
  mxpy data store --partition $NETWORK_NAME --key=admin-address --value=$admin_pem_address
}

deploy() {
    mxpy --verbose contract clean || return
    mxpy --verbose contract build || return

    mxpy --verbose contract deploy --project . \
        --recall-nonce --gas-limit=25000000 \
        --proxy=$PROXY --chain=$CHAIN_ID \
        --outfile="deploy-$NETWORK_NAME.interaction.json" \
        --metadata-payable-by-sc \
        --metadata-payable \
        --pem $ADMIN_PEM \
        --send || return

    TRANSACTION=$(mxpy data parse --file="deploy-${NETWORK_NAME}.interaction.json" --expression="data['emittedTransactionHash']")
    CONTRACT_ADDRESS=$(mxpy data parse --file="deploy-${NETWORK_NAME}.interaction.json" --expression="data['contractAddress']")

    mxpy data store --partition $NETWORK_NAME --key=deploy-transaction --value=$TRANSACTION
    mxpy data store --partition $NETWORK_NAME --key=contract-address --value=$CONTRACT_ADDRESS

    echo ""
    echo "deployed smart contract address: $CONTRACT_ADDRESS"
}

# params:
#   $1 = token id
setItheumTokenId() {
    mxpy data store --partition $NETWORK_NAME --key=itheum-tokenid --value=$1
}

# params:
#   $1 = nft id
setTrailblazerNftId() {
    mxpy data store --partition $NETWORK_NAME --key=trailblazer-nftid --value=$1
}

upgrade() {
    mxpy --verbose contract clean || return
    mxpy --verbose contract build || return

    mxpy --verbose contract upgrade $CONTRACT_ADDRESS --project . \
        --recall-nonce --gas-limit=25000000 \
        --proxy=$PROXY --chain=$CHAIN_ID \
        --metadata-payable-by-sc \
        --metadata-payable \
        --pem $ADMIN_PEM \
        --send || return
}

# params:
#   $1 = address
getDaoVoteWeight() {
    mxpy contract query $CONTRACT_ADDRESS \
        --function="getDaoVoteWeight" \
        --arguments $1 \
        --proxy=$PROXY || return
}

getDaoMembers() {
    mxpy contract query $CONTRACT_ADDRESS \
        --function="getDaoMembers" \
        --proxy=$PROXY || return
}
