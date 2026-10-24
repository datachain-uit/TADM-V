const WEI_PER_ETH = 10n ** 18n

export function formatEth(wei: string | null | undefined): string {
  if (!wei) return '—'
  const value = BigInt(wei)
  const whole = value / WEI_PER_ETH
  const fraction = (value % WEI_PER_ETH).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction} ETH` : `${whole} ETH`
}

export function ethToWei(eth: string): string {
  const trimmed = eth.trim()
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) {
    throw new Error('Invalid ETH amount (at most 18 decimal places)')
  }
  const [whole = '0', fraction = ''] = trimmed.split('.')
  return (BigInt(whole) * WEI_PER_ETH + BigInt(fraction.padEnd(18, '0'))).toString()
}

export function shortHex(value: string | null | undefined, keep = 6): string {
  if (!value) return '—'
  return value.length <= keep * 2 + 2 ? value : `${value.slice(0, keep + 2)}…${value.slice(-keep)}`
}
