import useAsync from '@/hooks/useAsync'
import type { TransactionDetails } from '@safe-global/safe-gateway-typescript-sdk'
import { getMultiSendCallOnlyContract } from '@/services/contracts/safeContracts'
import { useCurrentChain } from '@/hooks/useChains'
import useSafeInfo from '@/hooks/useSafeInfo'
import { encodeMultiSendData } from '@safe-global/safe-core-sdk/dist/src/utils/transactions/utils'
import { Box, Button, CircularProgress, DialogContent, SvgIcon, Typography } from '@mui/material'
import SendToBlock from '@/components/tx/SendToBlock'
import { type SyntheticEvent, useMemo, useState } from 'react'
import { generateDataRowValue } from '@/components/transactions/TxDetails/Summary/TxDataRow'
import { Errors, logError } from '@/services/exceptions'
import ErrorMessage from '@/components/tx/ErrorMessage'
import type { BatchExecuteData } from '@/components/tx/modals/BatchExecuteModal/index'
import DecodedTxs from '@/components/tx/modals/BatchExecuteModal/DecodedTxs'
import { getMultiSendTxs, getTxsWithDetails } from '@/utils/transactions'
import { TxSimulation } from '@/components/tx/TxSimulation'
import { useRemainingRelaysBySafe } from '@/hooks/useRemainingRelays'
import SponsoredBy from '@/components/tx/SponsoredBy'
import { dispatchBatchExecution, dispatchBatchExecutionRelay } from '@/services/tx/tx-sender'
import useOnboard from '@/hooks/wallets/useOnboard'
import { WrongChainWarning } from '@/components/tx/WrongChainWarning'
import { useWeb3 } from '@/hooks/wallets/web3'
import { getSimulationPayload, getSimulation } from '../../TxSimulation/utils'
import useWallet from '@/hooks/wallets/useWallet'
import CrossIcon from '@/public/images/transactions/circle-cross-red.svg'
import type { TenderlySimulation } from '../../TxSimulation/types'
import type { MetaTransactionData } from '@safe-global/safe-core-sdk-types'

export const _getValidBatch = (allMultiSendTxs: MetaTransactionData[], simulation: TenderlySimulation) => {
  const callErrors = simulation.transaction.call_trace.filter((call) => {
    return call.error
  })

  if (callErrors.length === 0) {
    return allMultiSendTxs
  }

  const firstRevertedTx = allMultiSendTxs.findIndex((tx) => {
    return callErrors.some((error) => tx.data === error.input)
  })

  return firstRevertedTx !== -1 ? allMultiSendTxs.slice(0, firstRevertedTx) : allMultiSendTxs
}

const ReviewBatchExecute = ({ data, onSubmit }: { data: BatchExecuteData; onSubmit: (data: null) => void }) => {
  const [isSubmittable, setIsSubmittable] = useState<boolean>(true)
  const [submitError, setSubmitError] = useState<Error | undefined>()
  const chain = useCurrentChain()
  const { safe } = useSafeInfo()
  const [remainingRelays] = useRemainingRelaysBySafe()
  const wallet = useWallet()

  // Chain has relaying feature and available relays
  const willRelay = !!remainingRelays
  const onboard = useOnboard()
  const web3 = useWeb3()

  const [txsWithDetails, txWithDetailsError, txWithDetailsLoading] = useAsync<TransactionDetails[]>(() => {
    if (!chain?.chainId) return

    return getTxsWithDetails(data.txs, chain.chainId)
  }, [data.txs, chain?.chainId])

  const multiSendContract = useMemo(() => {
    if (!chain?.chainId || !safe.version || !web3) return
    return getMultiSendCallOnlyContract(chain.chainId, safe.version, web3)
  }, [chain?.chainId, safe.version, web3])

  const allMultiSendTxs = useMemo(() => {
    if (!txsWithDetails || !chain || !safe.version) return
    return getMultiSendTxs(txsWithDetails, chain, safe.address.value, safe.version)
  }, [chain, safe.address.value, safe.version, txsWithDetails])

  const [simulation, simulationError, simulationLoading] = useAsync(async () => {
    if (!wallet?.address || !allMultiSendTxs) return

    const simulationPayload = await getSimulationPayload({
      canExecute: true,
      executionOwner: wallet.address,
      safe,
      transactions: allMultiSendTxs,
    })

    // Use default Tenderly API
    return getSimulation(simulationPayload, undefined)
  }, [wallet?.address, safe.address.value, allMultiSendTxs])

  const validMultiSendTxs = useMemo(() => {
    // Simulation failed, return all txs
    if (simulationError) {
      console.log('error')
      return allMultiSendTxs
    }

    if (!allMultiSendTxs || !simulation) return

    return _getValidBatch(allMultiSendTxs, simulation)
  }, [allMultiSendTxs, simulation, simulationError])

  const validTxsWithDetails =
    txsWithDetails && validMultiSendTxs ? txsWithDetails.slice(0, validMultiSendTxs.length) : undefined
  const invalidTxsWithDetails =
    txsWithDetails && validMultiSendTxs ? txsWithDetails.slice(validMultiSendTxs.length) : undefined

  const multiSendTxData = useMemo(() => {
    if (!validMultiSendTxs) return
    return encodeMultiSendData(validMultiSendTxs)
  }, [validMultiSendTxs])

  const onExecute = async () => {
    if (!onboard || !multiSendTxData || !multiSendContract || !validTxsWithDetails) return

    await dispatchBatchExecution(validTxsWithDetails, multiSendContract, multiSendTxData, onboard, safe.chainId)

    onSubmit(null)
  }

  const onRelay = async () => {
    if (!multiSendTxData || !multiSendContract || !validTxsWithDetails) return

    await dispatchBatchExecutionRelay(validTxsWithDetails, multiSendContract, multiSendTxData, safe.chainId)

    onSubmit(null)
  }

  const handleSubmit = async (e: SyntheticEvent) => {
    e.preventDefault()
    setIsSubmittable(false)
    setSubmitError(undefined)

    try {
      await (willRelay ? onRelay() : onExecute())
    } catch (err) {
      logError(Errors._804, (err as Error).message)
      setIsSubmittable(true)
      setSubmitError(err as Error)
      return
    }
  }

  const isLoading = txWithDetailsLoading || simulationLoading
  const submitDisabled = isLoading || !isSubmittable

  return (
    <div>
      <DialogContent>
        <Typography variant="body2" mb={2}>
          This transaction {isLoading ? 'will batch' : 'batches'} a total of {data.txs.length} transactions from your
          queue into a single Ethereum transaction. Please check every included transaction carefully, especially if you
          have rejection transactions, and make sure you want to execute all of them. Included transactions are
          highlighted in green when you hover over the execute button.
        </Typography>

        {isLoading ? (
          <Box py={4} textAlign="center">
            <CircularProgress size={40} />
          </Box>
        ) : (
          <>
            {multiSendContract && <SendToBlock address={multiSendContract.getAddress()} title="Interact with:" />}

            {multiSendTxData && (
              <>
                <Typography mt={2} color="primary.light">
                  Data (hex encoded)
                </Typography>
                {generateDataRowValue(multiSendTxData, 'rawData')}
              </>
            )}

            <Typography mt={2} color="primary.light">
              Batched transactions:
            </Typography>

            <DecodedTxs txs={validTxsWithDetails} />

            {invalidTxsWithDetails && invalidTxsWithDetails.length > 0 && (
              <>
                <Typography mt={2} color="primary.light" display="flex" alignItems="center">
                  <SvgIcon component={CrossIcon} inheritViewBox color="border" fontSize="small" sx={{ mr: 0.5 }} />{' '}
                  Excluded transactions:
                </Typography>
                <Typography variant="body2" mb={2}>
                  The following transactions are excluded from the batch as they will otherwise cause it to fail.
                </Typography>
                <DecodedTxs txs={invalidTxsWithDetails} />
              </>
            )}

            {willRelay ? (
              <>
                <Typography mt={2} mb={1} color="primary.light">
                  Gas fees:
                </Typography>
                <SponsoredBy
                  remainingRelays={remainingRelays}
                  tooltip="You can only relay multisend transactions containing
executions from the same Safe."
                />
              </>
            ) : null}

            {validMultiSendTxs && (
              <TxSimulation canExecute transactions={validMultiSendTxs} disabled={submitDisabled} />
            )}
          </>
        )}

        <WrongChainWarning />

        <Typography variant="body2" mt={2} textAlign="center">
          Be aware that if any of the included transactions revert, none of them will be executed. This will result in
          the loss of the allocated transaction fees.
        </Typography>

        {txWithDetailsError && (
          <ErrorMessage error={txWithDetailsError}>
            This transaction will most likely fail. To save gas costs, avoid creating the transaction.
          </ErrorMessage>
        )}

        {submitError && (
          <ErrorMessage error={submitError}>Error submitting the transaction. Please try again.</ErrorMessage>
        )}

        <Button
          onClick={handleSubmit}
          disabled={submitDisabled}
          variant="contained"
          sx={{ position: 'absolute', bottom: '24px', right: '24px', zIndex: 1 }}
        >
          Send
        </Button>
      </DialogContent>
    </div>
  )
}

export default ReviewBatchExecute
