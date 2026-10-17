import React, { createContext, useContext, useState } from 'react'

export type CurrencyCode = 'NGN' | 'USD' | 'GHS' | 'KES' | 'TZS'

export interface CurrencyConfig {
  code: CurrencyCode
  symbol: string
  name: string
  flag: string
  rateFromNgn: number // exchange rate multiplier relative to NGN
  decimals: number
  isSettlement: boolean
}

export const SUPPORTED_CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  NGN: {
    code: 'NGN',
    symbol: '₦',
    name: 'Nigerian Naira',
    flag: '🇳🇬',
    rateFromNgn: 1.0,
    decimals: 0,
    isSettlement: true,
  },
  USD: {
    code: 'USD',
    symbol: '$',
    name: 'US Dollar',
    flag: '🇺🇸',
    rateFromNgn: 1 / 1500,
    decimals: 2,
    isSettlement: false,
  },
  GHS: {
    code: 'GHS',
    symbol: 'GH₵',
    name: 'Ghanaian Cedi',
    flag: '🇬🇭',
    rateFromNgn: 1 / 105,
    decimals: 2,
    isSettlement: false,
  },
  KES: {
    code: 'KES',
    symbol: 'KSh',
    name: 'Kenyan Shilling',
    flag: '🇰🇪',
    rateFromNgn: 1 / 11.6,
    decimals: 0,
    isSettlement: false,
  },
  TZS: {
    code: 'TZS',
    symbol: 'TSh',
    name: 'Tanzanian Shilling',
    flag: '🇹🇿',
    rateFromNgn: 1 / 0.58,
    decimals: 0,
    isSettlement: false,
  },
}

interface CurrencyContextValue {
  currentCurrency: CurrencyConfig
  currencyCode: CurrencyCode
  setCurrencyCode: (code: CurrencyCode) => void
  formatPrice: (priceMinorNgn: number) => string
  formatBaseNgn: (priceMinorNgn: number) => string
  supportedCurrencies: CurrencyConfig[]
}

const STORAGE_KEY = 'logspoll-display-currency'

const CurrencyContext = createContext<CurrencyContextValue>({
  currentCurrency: SUPPORTED_CURRENCIES.NGN,
  currencyCode: 'NGN',
  setCurrencyCode: () => {},
  formatPrice: (minor) => `₦${(minor / 100).toLocaleString('en-NG')}`,
  formatBaseNgn: (minor) => `₦${(minor / 100).toLocaleString('en-NG')}`,
  supportedCurrencies: Object.values(SUPPORTED_CURRENCIES),
})

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currencyCode, setCode] = useState<CurrencyCode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as CurrencyCode | null
      if (stored && stored in SUPPORTED_CURRENCIES) return stored
    } catch {
      // storage unavailable
    }
    return 'NGN'
  })

  const setCurrencyCode = (code: CurrencyCode) => {
    if (code in SUPPORTED_CURRENCIES) {
      setCode(code)
      try {
        localStorage.setItem(STORAGE_KEY, code)
      } catch {
        // storage unavailable
      }
    }
  }

  const currentCurrency = SUPPORTED_CURRENCIES[currencyCode] ?? SUPPORTED_CURRENCIES.NGN

  const formatPrice = (priceMinorNgn: number) => {
    const ngnMajor = priceMinorNgn / 100
    if (currentCurrency.code === 'NGN') {
      return `₦${ngnMajor.toLocaleString('en-NG', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })}`
    }
    const converted = ngnMajor * currentCurrency.rateFromNgn
    return `${currentCurrency.symbol}${converted.toLocaleString('en-US', {
      minimumFractionDigits: currentCurrency.decimals,
      maximumFractionDigits: currentCurrency.decimals,
    })}`
  }

  const formatBaseNgn = (priceMinorNgn: number) => {
    const ngnMajor = priceMinorNgn / 100
    return `₦${ngnMajor.toLocaleString('en-NG', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`
  }

  return (
    <CurrencyContext.Provider
      value={{
        currentCurrency,
        currencyCode,
        setCurrencyCode,
        formatPrice,
        formatBaseNgn,
        supportedCurrencies: Object.values(SUPPORTED_CURRENCIES),
      }}
    >
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}

export function CurrencySelector({ className = '' }: { className?: string }) {
  const { currencyCode, setCurrencyCode, supportedCurrencies } = useCurrency()

  return (
    <label className={`currency-selector ${className}`} aria-label="Select display currency">
      <span className="sr-only">Display Currency</span>
      <select
        value={currencyCode}
        onChange={(e) => setCurrencyCode(e.target.value as CurrencyCode)}
        aria-label="Currency"
        title="Display Currency (Payment settled in NGN)"
      >
        {supportedCurrencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.code} ({c.symbol})
          </option>
        ))}
      </select>
    </label>
  )
}

