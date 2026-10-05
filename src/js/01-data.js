/*
 * Canonical statement data object — ILLUSTRATIVE DEMO DATA.
 *
 * Every name, account, address, amount, reference and blockchain detail below is
 * invented. No real customer information is embedded (PRD 6, rule 6).
 *
 * Amounts are signed integers in the asset's minor units (precision 2 → cents),
 * so reconciliation is exact: no floating-point rounding can "fix" a mismatch.
 *
 * Date semantics (PRD 3, 6.3):
 *   initiatedAt — when the customer or counterparty started the transaction
 *   postedAt    — when it was posted to the account (the statement's period basis)
 * A transaction belongs to this statement when postedAt falls inside the period.
 * Same-timestamp ties are ordered by `seq` (a parent movement before its fee).
 * Pending transactions have no postedAt and are never included in the balance.
 */
(function (root) {
  'use strict';
  var YES = (root.YES = root.YES || {});

  YES.data = {
    illustrative: true,

    statement: {
      id: 'YES-STM-202609-000184',
      version: '1.0',
      issueStatus: 'original', // original | corrected
      periodStart: '2026-09-01T00:00:00-04:00',
      periodEnd: '2026-09-30T23:59:59-04:00',
      asOf: '2026-09-30T23:59:59-04:00',
      generatedAt: '2026-10-01T06:15:00-04:00',
      timezone: 'America/New_York',
      dateBasis: 'posted',
      language: 'en',
      customer: {
        firstName: 'Sam',
        displayName: 'Sam Ortega',
        address: ['100 Sample Avenue, Apt 4', 'Anytown, ST 00000']
      },
      account: {
        label: { en: 'YES bank-issued digital dollar account', es: 'Cuenta YES de dólares digitales emitidos por un banco' },
        maskedId: '•••• 7316',
        walletMasked: '0x5A…E19C'
      },
      assetId: 'USBC',
      opening: 100000, // 1,000.00
      closing: 114750 // 1,147.50
    },

    assets: {
      USBC: {
        id: 'USBC',
        name: { en: 'US Bank Coin', es: 'US Bank Coin' },
        symbol: 'USBC',
        precision: 2,
        unitLabel: { en: 'token units', es: 'unidades de token' },
        /* Optional fiat equivalent (PRD 4, 6): shown only when rate, source and
           timestamp are all present AND the rate is verified. This demo rate is
           not verified; it is shown only because the showcase is in demo mode and
           the rate is marked illustrative (labelled "Illustrative" wherever it
           appears) — not a market quote or a peg guarantee. */
        fiat: {
          currency: 'USD',
          rate: '1.0000',
          rateMicros: 1000000, // rate × 1,000,000, so conversion stays in integers
          source: { en: 'Illustrative demo rate — not a market quote', es: 'Tasa ilustrativa de demostración — no es una cotización de mercado' },
          at: '2026-09-30T23:59:59-04:00',
          verified: false,
          illustrative: true
        }
      }
    },

    /* Balance-journey categories. Each step's total is derived from the
       transactions whose `type` is listed — never typed in by hand. */
    categories: [
      { id: 'deposits', group: 'incoming', types: ['deposit'] },
      { id: 'transfers_in', group: 'incoming', types: ['transfer_in'] },
      { id: 'transfers_out', group: 'outgoing', types: ['transfer_out'] },
      { id: 'redemptions', group: 'outgoing', types: ['redemption'] },
      { id: 'fees', group: 'outgoing', types: ['fee'] }
    ],

    transactions: [
      {
        id: 'TX-260901-0418',
        seq: 1,
        type: 'deposit',
        rail: 'other',
        method: 'bank_transfer',
        status: 'posted',
        initiatedAt: '2026-08-31T21:14:00-04:00',
        postedAt: '2026-09-01T09:02:00-04:00',
        amount: 25000,
        asset: 'USBC',
        balanceAfter: 125000,
        counterparty: { en: 'Linked bank account •••• 4821', es: 'Cuenta bancaria vinculada •••• 4821' },
        description: { en: 'Deposit from linked bank account', es: 'Depósito desde cuenta bancaria vinculada' },
        reference: 'REF-D7K2-9QW4',
        fees: [],
        notes: [
          {
            en: 'Initiated on August 31 (previous period) and posted on September 1. Statements use the posted date, so it belongs to this statement.',
            es: 'Se inició el 31 de agosto (período anterior) y se registró el 1 de septiembre. Los estados de cuenta usan la fecha de registro, por eso pertenece a este estado de cuenta.'
          }
        ],
        priorPeriodInitiation: true
      },
      {
        id: 'TX-260903-1127',
        seq: 2,
        type: 'transfer_out',
        rail: 'internal',
        method: 'yes_transfer',
        status: 'posted',
        initiatedAt: '2026-09-03T18:40:00-04:00',
        postedAt: '2026-09-03T18:40:00-04:00',
        amount: -12000,
        asset: 'USBC',
        balanceAfter: 113000,
        counterparty: { en: 'Daniel K.', es: 'Daniel K.' },
        description: { en: 'Transfer to another YES customer', es: 'Transferencia a otro cliente de YES' },
        memo: 'Rent share',
        reference: 'REF-T3M8-4LZ1',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260905-0733',
        seq: 3,
        type: 'transfer_in',
        rail: 'internal',
        method: 'yes_transfer',
        status: 'posted',
        initiatedAt: '2026-09-05T12:15:00-04:00',
        postedAt: '2026-09-05T12:15:00-04:00',
        amount: 4500,
        asset: 'USBC',
        balanceAfter: 117500,
        counterparty: { en: 'Marisol R.', es: 'Marisol R.' },
        description: { en: 'Transfer from another YES customer', es: 'Transferencia de otro cliente de YES' },
        memo: 'Dinner',
        reference: 'REF-R5P1-8HX6',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260909-2051',
        seq: 4,
        type: 'transfer_out',
        rail: 'onchain',
        method: 'network_send',
        status: 'posted',
        initiatedAt: '2026-09-09T10:21:00-04:00',
        postedAt: '2026-09-09T10:34:00-04:00',
        amount: -20000,
        asset: 'USBC',
        balanceAfter: 97500,
        counterparty: { en: 'External wallet 0x9C1D…44B7', es: 'Monedero externo 0x9C1D…44B7' },
        description: { en: 'Sent to an external wallet on a blockchain network', es: 'Envío a un monedero externo en una red blockchain' },
        reference: 'REF-N8C4-2VB9',
        fees: [{ asset: 'USBC', amount: 100, kind: 'network_transfer', feeTxId: 'TX-260909-2052' }],
        notes: [
          {
            en: 'The transfer fee is shown as its own line so each amount can be traced.',
            es: 'La comisión de transferencia aparece como una línea propia para que cada importe pueda rastrearse.'
          }
        ],
        /* The single sample on-chain reference (PRD 5.6). Not verified, not linked
           to any real explorer. */
        onchain: {
          network: { en: 'Example Network (illustrative)', es: 'Example Network (ilustrativa)' },
          hash: '0xDE40000000000000000000000000000000000000000000000000000000E19C',
          hashDisplay: '0xDE40…E19C',
          confirmations: 64,
          verified: false,
          illustrative: true
        }
      },
      {
        id: 'TX-260909-2052',
        seq: 5,
        type: 'fee',
        rail: 'internal',
        method: 'fee',
        status: 'posted',
        initiatedAt: '2026-09-09T10:34:00-04:00',
        postedAt: '2026-09-09T10:34:00-04:00',
        amount: -100,
        asset: 'USBC',
        balanceAfter: 97400,
        parentId: 'TX-260909-2051',
        feeKind: 'network_transfer',
        counterparty: { en: 'YES service fee', es: 'Comisión de servicio de YES' },
        description: { en: 'Fee for sending to an external wallet', es: 'Comisión por envío a un monedero externo' },
        reference: 'REF-F2N9-6QD3',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260912-0805',
        seq: 6,
        type: 'deposit',
        rail: 'other',
        method: 'debit_card',
        status: 'posted',
        initiatedAt: '2026-09-12T08:05:00-04:00',
        postedAt: '2026-09-12T08:05:00-04:00',
        amount: 10000,
        asset: 'USBC',
        balanceAfter: 107400,
        counterparty: { en: 'Debit card •••• 1190', es: 'Tarjeta de débito •••• 1190' },
        description: { en: 'Deposit by debit card', es: 'Depósito con tarjeta de débito' },
        reference: 'REF-C6V3-1KE7',
        fees: [{ asset: 'USBC', amount: 50, kind: 'card_deposit', feeTxId: 'TX-260912-0806' }],
        notes: []
      },
      {
        id: 'TX-260912-0806',
        seq: 7,
        type: 'fee',
        rail: 'internal',
        method: 'fee',
        status: 'posted',
        initiatedAt: '2026-09-12T08:05:00-04:00',
        postedAt: '2026-09-12T08:05:00-04:00',
        amount: -50,
        asset: 'USBC',
        balanceAfter: 107350,
        parentId: 'TX-260912-0805',
        feeKind: 'card_deposit',
        counterparty: { en: 'YES service fee', es: 'Comisión de servicio de YES' },
        description: { en: 'Fee for depositing by debit card', es: 'Comisión por depósito con tarjeta de débito' },
        reference: 'REF-F7C2-3JW8',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260915-1648',
        seq: 8,
        type: 'transfer_in',
        rail: 'onchain',
        method: 'network_receive',
        status: 'posted',
        initiatedAt: '2026-09-15T16:48:00-04:00',
        postedAt: '2026-09-15T17:02:00-04:00',
        amount: 8000,
        asset: 'USBC',
        balanceAfter: 115350,
        counterparty: { en: 'External wallet 0x3F7A…08D2', es: 'Monedero externo 0x3F7A…08D2' },
        description: { en: 'Received from an external wallet on a blockchain network', es: 'Recibido de un monedero externo en una red blockchain' },
        reference: 'REF-N4H6-7TS2',
        fees: [],
        notes: [
          {
            en: 'Blockchain details are shown only when verified. Verified details for this transfer are not available in this demo.',
            es: 'Los detalles de blockchain solo se muestran cuando están verificados. Los detalles verificados de esta transferencia no están disponibles en esta demostración.'
          }
        ]
      },
      {
        id: 'TX-260918-2011',
        seq: 9,
        type: 'transfer_out',
        rail: 'internal',
        method: 'yes_transfer',
        status: 'posted',
        initiatedAt: '2026-09-18T20:11:00-04:00',
        postedAt: '2026-09-18T20:11:00-04:00',
        amount: -6000,
        asset: 'USBC',
        balanceAfter: 109350,
        counterparty: { en: 'Sofia P.', es: 'Sofia P.' },
        description: { en: 'Transfer to another YES customer', es: 'Transferencia a otro cliente de YES' },
        memo: 'Concert tickets',
        reference: 'REF-T9B5-0MA3',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260920-0900',
        seq: 10,
        type: 'redemption',
        rail: 'other',
        method: 'bank_payout',
        status: 'posted',
        initiatedAt: '2026-09-19T15:30:00-04:00',
        postedAt: '2026-09-20T09:00:00-04:00',
        amount: -10000,
        asset: 'USBC',
        balanceAfter: 99350,
        counterparty: { en: 'Linked bank account •••• 4821', es: 'Cuenta bancaria vinculada •••• 4821' },
        description: { en: 'Redeemed tokens for US dollars paid to your bank', es: 'Canje de tokens por dólares estadounidenses pagados a tu banco' },
        reference: 'REF-X1R7-5GN2',
        fees: [{ asset: 'USBC', amount: 100, kind: 'redemption', feeTxId: 'TX-260920-0901' }],
        notes: [
          {
            en: 'Requested on 19 September and posted on 20 September.',
            es: 'Solicitado el 19 de septiembre y registrado el 20 de septiembre.'
          }
        ]
      },
      {
        id: 'TX-260920-0901',
        seq: 11,
        type: 'fee',
        rail: 'internal',
        method: 'fee',
        status: 'posted',
        initiatedAt: '2026-09-20T09:00:00-04:00',
        postedAt: '2026-09-20T09:00:00-04:00',
        amount: -100,
        asset: 'USBC',
        balanceAfter: 99250,
        parentId: 'TX-260920-0900',
        feeKind: 'redemption',
        counterparty: { en: 'YES service fee', es: 'Comisión de servicio de YES' },
        description: { en: 'Fee for redeeming tokens', es: 'Comisión por canje de tokens' },
        reference: 'REF-F5X8-2PL6',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260922-0901',
        seq: 12,
        type: 'deposit',
        rail: 'other',
        method: 'bank_transfer',
        status: 'posted',
        initiatedAt: '2026-09-21T19:45:00-04:00',
        postedAt: '2026-09-22T09:01:00-04:00',
        amount: 15000,
        asset: 'USBC',
        balanceAfter: 114250,
        counterparty: { en: 'Linked bank account •••• 4821', es: 'Cuenta bancaria vinculada •••• 4821' },
        description: { en: 'Deposit from linked bank account', es: 'Depósito desde cuenta bancaria vinculada' },
        reference: 'REF-D2W6-8YF1',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260924-1327',
        seq: 13,
        type: 'transfer_out',
        rail: 'internal',
        method: 'yes_payment',
        status: 'posted',
        initiatedAt: '2026-09-24T13:27:00-04:00',
        postedAt: '2026-09-24T13:27:00-04:00',
        amount: -4550,
        asset: 'USBC',
        balanceAfter: 109700,
        counterparty: { en: 'Northside Market', es: 'Northside Market' },
        description: { en: 'Payment to a YES merchant', es: 'Pago a un comercio de YES' },
        memo: 'Groceries',
        reference: 'REF-M8Q2-4DK9',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260926-1009',
        seq: 14,
        type: 'transfer_in',
        rail: 'internal',
        method: 'yes_transfer',
        status: 'posted',
        initiatedAt: '2026-09-26T10:09:00-04:00',
        postedAt: '2026-09-26T10:09:00-04:00',
        amount: 7500,
        asset: 'USBC',
        balanceAfter: 117200,
        counterparty: { en: 'Marisol R.', es: 'Marisol R.' },
        description: { en: 'Transfer from another YES customer', es: 'Transferencia de otro cliente de YES' },
        memo: 'Trip refund',
        reference: 'REF-R2L9-6WC4',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260929-1952',
        seq: 15,
        type: 'transfer_out',
        rail: 'internal',
        method: 'yes_transfer',
        status: 'posted',
        initiatedAt: '2026-09-29T19:52:00-04:00',
        postedAt: '2026-09-29T19:52:00-04:00',
        amount: -2450,
        asset: 'USBC',
        balanceAfter: 114750,
        counterparty: { en: 'Daniel K.', es: 'Daniel K.' },
        description: { en: 'Transfer to another YES customer', es: 'Transferencia a otro cliente de YES' },
        memo: 'Utilities',
        reference: 'REF-T6J4-1NB8',
        fees: [],
        notes: []
      },
      {
        id: 'TX-260930-2247',
        seq: 16,
        type: 'redemption',
        rail: 'other',
        method: 'bank_payout',
        status: 'pending',
        initiatedAt: '2026-09-30T22:47:00-04:00',
        postedAt: null,
        amount: -3000,
        asset: 'USBC',
        balanceAfter: null,
        counterparty: { en: 'Linked bank account •••• 4821', es: 'Cuenta bancaria vinculada •••• 4821' },
        description: { en: 'Redemption request awaiting bank settlement', es: 'Solicitud de canje pendiente de liquidación bancaria' },
        reference: 'REF-X6P3-9AT5',
        fees: [],
        notes: [
          {
            en: 'Pending at the statement cut-off, so it is not included in this statement balance. If it completes, it will appear on your next statement.',
            es: 'Estaba pendiente al cierre del estado de cuenta, por eso no se incluye en este saldo. Si se completa, aparecerá en tu próximo estado de cuenta.'
          }
        ]
      }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
