import useIsSafeOwner from '@/hooks/useIsSafeOwner'
import useIsWrongChain from '@/hooks/useIsWrongChain'
import { SafeCollectibleResponse } from '@gnosis.pm/safe-react-gateway-sdk'
import { useState, type ReactElement } from 'react'
import NftTransferModal from '../tx/modals/NftTransferModal'
import NftGrid from './NftGrid'

const Nfts = ({ collectibles }: { collectibles: SafeCollectibleResponse[] }): ReactElement => {
  const [sendNft, setSendNft] = useState<SafeCollectibleResponse>()
  const isSafeOwner = useIsSafeOwner()
  const isWrongChain = useIsWrongChain()
  const isGranted = isSafeOwner && !isWrongChain

  return (
    <>
      <NftGrid collectibles={collectibles} onSendClick={isGranted ? (nft) => setSendNft(nft) : undefined} />

      {isGranted && sendNft && (
        <NftTransferModal
          onClose={() => setSendNft(undefined)}
          initialData={[
            {
              recipient: '',
              token: sendNft,
            },
          ]}
        />
      )}
    </>
  )
}

export default Nfts
