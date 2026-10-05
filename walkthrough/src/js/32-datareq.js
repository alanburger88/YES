/*
 * WT.dataReq — production data requirements for every feature (SPEC section 7).
 *
 * What YES's systems must supply to InfoSlips so each feature can render for a
 * real customer. Every field is defined ONCE in the catalogue below and each
 * feature lists the paths it needs, so a path shared by several features always
 * has the same type, example and description and the viewer can merge them.
 *
 * Names follow the statement's demo data model (../src/js/01-data.js) where it
 * makes sense. Examples are fictional and match the demo statement (Sam, USBC,
 * September 2026, YES-STM-202609-000184).
 *
 * Catalogue entry: path → [type, required, example, description, source].
 */
(function (WT) {
  'use strict';

  var S = {
    ledger: 'Core ledger',
    profile: 'Customer profile',
    chain: 'Blockchain / on-chain data',
    fx: 'Pricing & FX',
    content: 'Content management',
    support: 'Support / case management',
    ai: 'AI service',
    docgen: 'Document generation',
    a11y: 'Accessibility service',
    prefs: 'Preferences'
  };

  var TX_TYPES = 'deposit|transfer_in|transfer_out|redemption|fee';
  var FEE_KINDS = 'network_transfer|card_deposit|redemption';
  var EDU_TOPICS = 'token_units|usd_equivalent|onchain_vs_internal|tx_status|fees|redemption|statement_vs_live';
  var LANGS = 'en|es';

  var CATALOGUE = {
    /* ---------------- Statement envelope ---------------- */
    'statement.id': ['string', true, 'YES-STM-202609-000184', 'Unique statement number. It appears on every page, in file names and in support conversations.', S.ledger],
    'statement.version': ['string', true, '1.0', 'Version of this statement. It goes up each time YES reissues it.', S.ledger],
    'statement.issueStatus': ['string<enum: original|corrected>', true, 'original', 'Whether this is the original statement or a corrected reissue.', S.ledger],
    'statement.period.start': ['string<date-time>', true, '2026-09-01T00:00:00-04:00', 'Start of the statement period (inclusive), with the UTC offset of the statement time zone.', S.ledger],
    'statement.period.end': ['string<date-time>', true, '2026-09-30T23:59:59-04:00', 'End of the statement period (inclusive).', S.ledger],
    'statement.asOf': ['string<date-time>', true, '2026-09-30T23:59:59-04:00', 'Cut-off time of the balance snapshot. Activity after it belongs to the next statement.', S.ledger],
    'statement.generatedAt': ['string<date-time>', true, '2026-10-01T06:15:00-04:00', 'When YES extracted this statement data for InfoSlips.', S.ledger],
    'statement.timezone': ['string', true, 'America/New_York', 'IANA time zone used to show every date and time on the statement.', S.profile],
    'statement.dateBasis': ['string<enum: posted|initiated>', true, 'posted', 'Which date places a transaction in the period. YES statements use the posted date.', S.ledger],
    'statement.language': ['string<enum: ' + LANGS + '>', true, 'en', 'Language the statement opens in: the customer’s preferred language.', S.prefs],
    'statement.opening': ['integer<minor units>', true, 100000, 'Balance at the start of the period, in minor units of the statement asset (100000 = 1,000.00 USBC).', S.ledger],
    'statement.closing': ['integer<minor units>', true, 114750, 'Balance at the cut-off. It must equal the opening balance plus every posted movement.', S.ledger],
    'statement.controlTotals.postedCount': ['integer', false, 15, 'Number of posted transactions YES counted for the period. InfoSlips checks its own count against it.', S.ledger],
    'statement.controlTotals.netMovement': ['integer<minor units>', false, 14750, 'Net posted movement YES calculated for the period. InfoSlips checks its own sum against it.', S.ledger],
    'statement.correction.supersedesVersion': ['string', false, '1.0', 'For a corrected statement: the version it replaces.', S.ledger],
    'statement.correction.reason.en': ['string', false, 'A fee on 20 September was corrected.', 'For a corrected statement: what changed, in plain English.', S.ledger],

    /* ---------------- Customer ---------------- */
    'customer.id': ['string', true, 'CUS-0004182736', 'YES customer reference used to deliver the statement to the right person. Never displayed.', S.profile],
    'customer.firstName': ['string', true, 'Sam', 'First name used in the greeting and the video.', S.profile],
    'customer.displayName': ['string', true, 'Sam Ortega', 'Full name as it appears on the statement of record.', S.profile],
    'customer.address[]': ['string', true, '100 Sample Avenue, Apt 4', 'Mailing address lines for the statement of record (print and PDF), in display order.', S.profile],
    'customer.contact.emailMasked': ['string<masked>', false, 's•••@example.com', 'The email address on file, masked by YES, so the customer can confirm where a reply will go.', S.profile],
    'customer.contact.phoneMasked': ['string<masked>', false, '•••-•••-0199', 'The phone number on file, masked by YES.', S.profile],

    /* ---------------- Account and asset ---------------- */
    'account.maskedId': ['string<masked>', true, '•••• 7316', 'Account number with all but the last four digits masked by YES.', S.ledger],
    'account.label.en': ['string', true, 'YES bank-issued digital dollar account', 'Account product name in English.', S.content],
    'account.label.es': ['string', false, 'Cuenta YES de dólares digitales emitidos por un banco', 'Account product name in Spanish. Required when Spanish is offered.', S.content],
    'account.walletMasked': ['string<masked>', false, '0x5A…E19C', 'The customer’s YES wallet address, shortened and masked by YES.', S.chain],
    'account.liveBalance.amount': ['integer<minor units>', false, 111750, 'Balance right now, in minor units. Shown only in its own timestamped area, never mixed into statement figures.', S.ledger],
    'account.liveBalance.at': ['string<date-time>', false, '2026-10-04T18:40:00-04:00', 'When the live balance was read.', S.ledger],
    'account.liveBalance.appUri': ['string<uri>', false, 'https://app.example.com/yes/balance', 'Deep link to the live balance in the YES app.', S.content],
    'asset.id': ['string<currency>', true, 'USBC', 'Code of the bank-issued digital dollar the statement is in. Every balance and amount uses it.', S.ledger],
    'asset.symbol': ['string', true, 'USBC', 'Symbol shown beside amounts.', S.ledger],
    'asset.name.en': ['string', true, 'US Bank Coin', 'Product name of the asset in English.', S.content],
    'asset.precision': ['integer', true, 2, 'Decimal places of the asset. Amounts are integers in minor units at this precision.', S.ledger],
    'asset.unitLabel.en': ['string', false, 'token units', 'What one unit is called in English, for the explanations.', S.content],
    'asset.unitLabel.es': ['string', false, 'unidades de token', 'What one unit is called in Spanish.', S.content],
    'asset.fiat.currency': ['string<currency>', false, 'USD', 'Currency of the optional fiat equivalent.', S.fx],
    'asset.fiat.rate': ['string', false, '1.0000', 'Rate from the asset to the fiat currency, as a decimal string (never a float).', S.fx],
    'asset.fiat.source': ['string', false, 'Example FX reference rate', 'Name of the rate source, shown beside the equivalent.', S.fx],
    'asset.fiat.at': ['string<date-time>', false, '2026-09-30T23:59:59-04:00', 'When the rate was taken. It should match the statement cut-off.', S.fx],
    'asset.fiat.verified': ['boolean', false, true, 'Whether YES verified the rate. InfoSlips shows the equivalent only when this is true and the rate, source and time are present.', S.fx],

    /* ---------------- Transactions ---------------- */
    'transactions[].id': ['string', true, 'TX-260909-2051', 'Unique transaction ID, stable across statements and support systems.', S.ledger],
    'transactions[].seq': ['integer', true, 4, 'Ledger sequence. It orders transactions with the same posted time (a movement before its fee).', S.ledger],
    'transactions[].type': ['string<enum: ' + TX_TYPES + '>', true, 'transfer_out', 'Transaction type. InfoSlips groups types into the balance-journey categories.', S.ledger],
    'transactions[].status': ['string<enum: posted|pending|failed|unknown>', true, 'posted', 'Ledger status. Only posted transactions count in balances; the rest are listed and labelled.', S.ledger],
    'transactions[].rail': ['string<enum: internal|onchain|other>', true, 'onchain', 'Where the money moved: inside YES, on a blockchain network, or through a bank or card.', S.ledger],
    'transactions[].method': ['string<enum: bank_transfer|debit_card|yes_transfer|yes_payment|network_send|network_receive|bank_payout|fee>', false, 'network_send', 'How the money moved. It refines the label and icon.', S.ledger],
    'transactions[].initiatedAt': ['string<date-time>', true, '2026-09-09T10:21:00-04:00', 'When the customer or counterparty started the transaction.', S.ledger],
    'transactions[].postedAt': ['string<date-time>', true, '2026-09-09T10:34:00-04:00', 'When the transaction posted to the account. null while it is pending.', S.ledger],
    'transactions[].amount': ['integer<minor units>', true, -20000, 'Signed amount in minor units of the asset: positive in, negative out.', S.ledger],
    'transactions[].asset': ['string<currency>', true, 'USBC', 'Asset of the amount. Only amounts in the statement asset enter the balance.', S.ledger],
    'transactions[].balanceAfter': ['integer<minor units>', true, 97500, 'Ledger balance right after the transaction posted; null while pending. InfoSlips recomputes it and withholds the statement if they differ.', S.ledger],
    'transactions[].description.en': ['string', true, 'Sent to an external wallet on a blockchain network', 'Plain-language description in English.', S.ledger],
    'transactions[].description.es': ['string', false, 'Envío a un monedero externo en una red blockchain', 'Plain-language description in Spanish. Required when Spanish is offered.', S.ledger],
    'transactions[].counterparty.en': ['string', true, 'External wallet 0x9C1D…44B7', 'Who the money came from or went to, in English, with account numbers and addresses already masked by YES.', S.ledger],
    'transactions[].counterparty.es': ['string', false, 'Monedero externo 0x9C1D…44B7', 'The counterparty in Spanish, masked the same way.', S.ledger],
    'transactions[].memo': ['string', false, 'Rent share', 'The note the customer or the sender attached to the transfer, shown as written and never translated.', S.ledger],
    'transactions[].reference': ['string', true, 'REF-N8C4-2VB9', 'Reference the customer can quote to YES support.', S.ledger],
    'transactions[].parentId': ['string', false, 'TX-260909-2051', 'On a fee line: the ID of the transaction the fee was charged for.', S.ledger],
    'transactions[].feeKind': ['string<enum: ' + FEE_KINDS + '>', false, 'network_transfer', 'On a fee line: what the fee was for.', S.ledger],
    'transactions[].fees[].amount': ['integer<minor units>', false, 100, 'A fee charged for this transaction, as a positive amount in minor units.', S.ledger],
    'transactions[].fees[].asset': ['string<currency>', false, 'USBC', 'Asset the fee was charged in. Fees in another asset are listed separately, never bridged.', S.ledger],
    'transactions[].fees[].kind': ['string<enum: ' + FEE_KINDS + '>', false, 'network_transfer', 'What the fee was for.', S.ledger],
    'transactions[].fees[].feeTxId': ['string', false, 'TX-260909-2052', 'ID of the separate fee line that carries this fee, so the two link both ways.', S.ledger],
    'transactions[].notes[].en': ['string', false, 'The transfer fee is shown as its own line so each amount can be traced.', 'An explanatory note on this transaction, in English.', S.ledger],
    'transactions[].notes[].es': ['string', false, 'La comisión de transferencia aparece como una línea propia para que cada importe pueda rastrearse.', 'The same note in Spanish.', S.ledger],
    'transactions[].onchain.network': ['string', false, 'Example Network', 'Blockchain network of an on-chain transfer.', S.chain],
    'transactions[].onchain.hash': ['string', false, '0xDE40000000000000000000000000000000000000000000000000000000E19C', 'Full transaction hash. The statement shows it shortened.', S.chain],
    'transactions[].onchain.confirmations': ['integer', false, 64, 'Confirmations at the statement cut-off.', S.chain],
    'transactions[].onchain.verified': ['boolean', false, true, 'Whether YES verified the on-chain details. Unverified details are not shown.', S.chain],
    'transactions[].onchain.explorerUri': ['string<uri>', false, 'https://explorer.example.com/tx/0xDE40000000000000000000000000000000000000000000000000000000E19C', 'Approved block-explorer link for the transaction.', S.chain],

    /* ---------------- Approved content ---------------- */
    'content.issuer.name': ['string', true, 'Example Bank, N.A.', 'Legal name of the issuing bank or partner behind the bank-issued digital dollar.', S.content],
    'content.disclosures.en': ['string', true, 'USBC is a bank-issued digital dollar issued by Example Bank, N.A. See the approved terms for how it is backed and redeemed.', 'Approved legal disclosures in English, printed on the statement of record.', S.content],
    'content.disclosures.es': ['string', false, 'USBC es un dólar digital emitido por Example Bank, N.A. Consulta los términos aprobados para saber cómo está respaldado y cómo se canjea.', 'Approved legal disclosures in Spanish. Required when Spanish is offered.', S.content],
    'content.feeSchedule.uri': ['string<uri>', false, 'https://www.example.com/yes/fees', 'Link to the current YES fee schedule.', S.content],
    'content.education[].id': ['string<enum: ' + EDU_TOPICS + '>', true, 'token_units', 'Which explanation this record holds.', S.content],
    'content.education[].copyId': ['string', true, 'EDU-001-TOKEN-UNITS', 'Approved-copy ID, so every published wording can be traced.', S.content],
    'content.education[].version': ['string', true, '1.2', 'Version of the approved copy.', S.content],
    'content.education[].title.en': ['string', true, 'Token units', 'Title of the explanation in English.', S.content],
    'content.education[].title.es': ['string', false, 'Unidades de token', 'Title in Spanish.', S.content],
    'content.education[].body.en': ['string', true, 'Your balance is held in US Bank Coin (USBC), a bank-issued digital dollar. This statement counts it to 2 decimal places, so every amount is exact.', 'Approved explanation text in English. Figures are filled in from the statement by InfoSlips.', S.content],
    'content.education[].body.es': ['string', false, 'Tu saldo está en US Bank Coin (USBC), un dólar digital emitido por un banco. En este estado de cuenta se expresa con 2 decimales, así que cada importe es exacto.', 'Approved explanation text in Spanish.', S.content],
    'content.education[].responsibleEntity': ['string', true, 'YES Compliance', 'Team accountable for the wording.', S.content],
    'content.education[].approvedAt': ['string<date-time>', true, '2026-08-28T15:00:00-04:00', 'When the wording was approved.', S.content],
    'content.education[].validity.from': ['string<date-time>', true, '2026-09-01T00:00:00-04:00', 'First statement cut-off the wording may appear on.', S.content],
    'content.education[].validity.to': ['string<date-time>', false, '2027-03-31T23:59:59-04:00', 'Last cut-off it may appear on. Empty means no end date.', S.content],
    'content.evidence[].id': ['string<enum: issuer|reserve_report|attestation_date|redemption_terms|source_link>', true, 'reserve_report', 'Which transparency fact this record holds.', S.content],
    'content.evidence[].copyId': ['string', true, 'EVD-202-RESERVE-REPORT', 'Approved-copy ID of the fact.', S.content],
    'content.evidence[].value.en': ['string', true, 'Monthly reserve report, September 2026', 'The fact as shown, in English.', S.content],
    'content.evidence[].value.es': ['string', false, 'Informe mensual de reservas, septiembre de 2026', 'The fact as shown, in Spanish.', S.content],
    'content.evidence[].uri': ['string<uri>', false, 'https://www.example.com/yes/reserves/2026-09.pdf', 'Link to the published report, terms or source.', S.content],
    'content.evidence[].source': ['string', true, 'Example Assurance LLP', 'Who produced the evidence.', S.content],
    'content.evidence[].date': ['string<date>', true, '2026-09-30', 'Date the evidence refers to.', S.content],
    'content.evidence[].responsibleEntity': ['string', true, 'YES Treasury', 'Team at YES accountable for the fact.', S.content],
    'content.evidence[].validity.to': ['string<date-time>', true, '2026-10-31T23:59:59-04:00', 'When the fact goes stale. After this it is hidden and the page says so.', S.content],
    'content.evidence[].verified': ['boolean', true, true, 'Whether YES verified the fact. Unverified facts are never shown as claims.', S.content],
    'content.i18n.bundleVersion': ['string', true, 'yes-stmt-copy-2026.09.2', 'Version of the approved English and Spanish interface copy used for this statement run.', S.content],
    'content.i18n.locales': ['array', true, ['en-US', 'es-ES'], 'Locale tags for number and date formatting, one per offered language. The demo statement formats Spanish as es-ES; YES chooses the tag for its audience (es-US or es-MX for the Americas).', S.content],
    'content.i18n.fallbackLanguage': ['string<enum: ' + LANGS + '>', true, 'en', 'Language used when a translation is missing.', S.content],
    'content.glossary[].copyId': ['string', true, 'GLS-012-POSTED-DATE', 'Approved-copy ID of a glossary term.', S.content],
    'content.glossary[].term.en': ['string', true, 'Posted date', 'The term in English.', S.content],
    'content.glossary[].term.es': ['string', false, 'Fecha de registro', 'The approved Spanish term, used everywhere the term appears.', S.content],
    'content.glossary[].definition.en': ['string', true, 'The date a transaction was added to your account. Statements use it to place each transaction in a period.', 'Plain-language definition in English.', S.content],
    'content.glossary[].definition.es': ['string', false, 'La fecha en que un movimiento se registró en tu cuenta. Los estados de cuenta la usan para ubicar cada movimiento en un período.', 'Plain-language definition in Spanish.', S.content],

    /* ---------------- Video ---------------- */
    'content.video.scriptVersion': ['string', true, 'VID60-2026.09-v2', 'Version of the approved narration and caption script. InfoSlips fills in the customer’s figures.', S.content],
    'content.video.poster.uri': ['string<uri>', false, 'https://media.example.com/yes/video/poster-2026.jpg', 'Approved poster image shown before the first play.', S.content],
    'content.video.voiceover[].language': ['string<enum: ' + LANGS + '>', false, 'en', 'Language of a recorded voiceover.', S.content],
    'content.video.voiceover[].uri': ['string<uri>', false, 'https://media.example.com/yes/vo/YES-STM-202609-000184-en.mp3', 'Recorded or synthesised narration for this statement and language.', S.content],
    'content.video.voiceover[].scriptFingerprint': ['string', false, '9f3c41a7', 'Fingerprint of the exact script the audio reads (figures and caption wording). InfoSlips plays it only if it matches the statement’s own script; otherwise the device voice narrates.', S.content],
    'content.video.voiceover[].durationSeconds': ['number', false, 59.3, 'Length of the recording, in seconds.', S.content],
    'content.video.captions[].language': ['string<enum: ' + LANGS + '>', false, 'en', 'Language of a supplied caption track.', S.content],
    'content.video.captions[].uri': ['string<uri>', false, 'https://media.example.com/yes/vo/YES-STM-202609-000184-en.vtt', 'Approved caption track (WebVTT). Without one, InfoSlips generates captions from the script.', S.content],
    'content.video.captions[].scriptFingerprint': ['string', false, '9f3c41a7', 'Fingerprint of the script the captions were made from. It must match the voiceover’s.', S.content],

    /* ---------------- Brand, theme and preferences ---------------- */
    'brand.logo.uri': ['string<uri>', true, 'https://brand.example.com/yes/yes-logo-black.svg', 'Approved YES logo for light backgrounds (SVG preferred).', S.content],
    'brand.logo.darkUri': ['string<uri>', false, 'https://brand.example.com/yes/yes-logo-white.svg', 'Approved YES logo for dark backgrounds.', S.content],
    'brand.logo.alt': ['string', true, 'YES', 'Text alternative for the logo.', S.content],
    'brand.colors.primary': ['string', true, '#000000', 'Primary brand colour (hex) for light mode. InfoSlips checks it for 4.5:1 contrast.', S.content],
    'brand.colors.primaryDark': ['string', false, '#FFFFFF', 'Primary colour tuned for dark mode (hex).', S.content],
    'brand.colors.accent': ['string', false, '#0004FF', 'Accent colour (hex), used sparingly.', S.content],
    'brand.font.family': ['string', false, 'IBM Plex Sans', 'Brand typeface name. A system font is used when it is missing.', S.content],
    'brand.font.uri': ['string<uri>', false, 'https://brand.example.com/yes/fonts/ibm-plex-sans.woff2', 'Licensed web font file (WOFF2) for the brand typeface.', S.content],
    'preferences.theme': ['string<enum: light|dark|system>', false, 'system', 'Theme the customer chose in the YES app. With system, the statement follows the device.', S.prefs],
    'preferences.paperSize': ['string<enum: letter|a4>', false, 'letter', 'Paper size for the PDF and print version. Defaults to Letter for English and A4 for Spanish.', S.prefs],
    'preferences.accessibility.alternateFormat': ['string<enum: none|large_print|braille|audio>', false, 'none', 'An alternative statement format the customer has asked YES for.', S.prefs],
    'preferences.accessibility.reducedMotion': ['boolean', false, false, 'Reduced-motion setting saved in the YES app. The device setting always applies too.', S.prefs],
    'accessibility.userway.enabled': ['boolean', true, true, 'Whether to load the UserWay accessibility widget. Set false if the YES viewer already loads it.', S.a11y],
    'accessibility.userway.accountId': ['string', true, 'uw-yes-0000', 'YES’s UserWay account ID.', S.a11y],
    'accessibility.statementUri': ['string<uri>', false, 'https://www.example.com/yes/accessibility', 'Link to the YES accessibility statement and alternative-format requests.', S.a11y],

    /* ---------------- Support ---------------- */
    'support.phone': ['string', true, '+1 (555) 010-0142', 'Support phone number as displayed.', S.support],
    'support.email': ['string', true, 'help@example.com', 'Support email address.', S.support],
    'support.hours.en': ['string', true, 'Mon–Fri, 8 am–8 pm ET', 'Support opening hours in English.', S.support],
    'support.hours.es': ['string', false, 'Lun–vie, 8:00–20:00 ET', 'Support opening hours in Spanish.', S.support],
    'support.chatAvailable': ['boolean', false, false, 'Whether in-app chat is offered.', S.support],
    'support.feedback.enabled': ['boolean', false, true, 'Whether the “How clear was this statement?” feedback is collected.', S.support],
    'support.feedback.endpoint': ['string<uri>', false, 'https://api.example.com/yes/statement-feedback', 'Where InfoSlips sends the rating and optional comment.', S.support],
    'support.inquiry.enabled': ['boolean', true, true, 'Whether customers can raise an inquiry from the statement.', S.support],
    'support.inquiry.endpoint': ['string<uri>', true, 'https://api.example.com/yes/cases', 'Authenticated case-management endpoint that receives the inquiry and returns a case reference.', S.support],
    'support.inquiry.reasons': ['array', true, ['unrecognized', 'amount', 'pending', 'fee', 'other'], 'Inquiry reasons YES accepts. InfoSlips offers only the ones that fit each transaction.', S.support],
    'support.inquiry.channels': ['array', true, ['in_app', 'email', 'phone'], 'Reply channels the customer may choose. Contact details come from the profile, never from the form.', S.support],
    'support.inquiry.responseTargetDays': ['integer', false, 2, 'Business days within which YES aims to reply.', S.support],
    'support.cases[].txId': ['string', false, 'TX-260909-2052', 'Transaction an open inquiry is about.', S.support],
    'support.cases[].ref': ['string', false, 'CASE-2026-118402', 'Case reference to show the customer.', S.support],
    'support.cases[].status': ['string<enum: open|in_progress|resolved>', false, 'open', 'Where the inquiry stands.', S.support],
    'support.cases[].openedAt': ['string<date-time>', false, '2026-10-02T11:20:00-04:00', 'When the inquiry was raised.', S.support],
    'document.recordRetentionYears': ['integer', false, 7, 'How many years YES keeps the statement of record. Shown in the record section.', S.content],
    'integrity.alertEndpoint': ['string<uri>', true, 'https://api.example.com/yes/statement-exceptions', 'Where InfoSlips reports a statement that failed its checks, so YES can correct and reissue it.', S.support],

    /* ---------------- AI service ---------------- */
    'ai.enabled': ['boolean', true, true, 'Whether YES’s governed AI service is switched on for this customer.', S.ai],
    'ai.endpoint': ['string<uri>', true, 'https://ai.example.com/yes/statement-assistant/v1', 'Endpoint of the approved AI service.', S.ai],
    'ai.policyVersion': ['string', true, 'yes-ai-policy-2026.09', 'Version of the approved prompt and policy. Stored with each answer for audit.', S.ai],
    'ai.inputFields': [
      'array',
      true,
      [
        'statement.period.start',
        'statement.period.end',
        'statement.asOf',
        'statement.opening',
        'statement.closing',
        'asset.id',
        'asset.precision',
        'transactions[].id',
        'transactions[].type',
        'transactions[].status',
        'transactions[].rail',
        'transactions[].postedAt',
        'transactions[].amount',
        'transactions[].balanceAfter',
        'transactions[].description.en',
        'transactions[].fees[].amount',
        'transactions[].onchain.network',
        'transactions[].onchain.hash',
        'transactions[].onchain.confirmations',
        'transactions[].onchain.verified'
      ],
      'The only statement fields the AI service receives, besides the customer’s own question. Names, addresses, account numbers, memos, counterparties and wallet addresses are never sent, and on-chain details only when verified.',
      S.ai
    ],
    'ai.guardrails.maxAnswerChars': ['integer', true, 900, 'Longest answer the service may return.', S.ai],
    'ai.guardrails.blockedTopics': ['array', true, ['investment advice', 'price predictions', 'account changes', 'other customers'], 'Topics the service declines, pointing the customer to human help instead.', S.ai],
    'ai.guardrails.maskIdentifiers': ['boolean', true, true, 'Masked identifiers stay masked in everything the service receives and returns.', S.ai],
    'ai.guardrails.citeRows': ['boolean', true, true, 'Each answer lists the transaction IDs it used, so the statement can show the rows behind it.', S.ai],
    'ai.disclaimer.en': ['string', true, 'Answers use this statement only. They are not financial advice.', 'Approved disclaimer shown with every answer, in English.', S.content],
    'ai.disclaimer.es': ['string', false, 'Las respuestas usan solo este estado de cuenta. No son asesoramiento financiero.', 'Approved disclaimer in Spanish.', S.content],
    'ai.suggestedQuestions': ['array', false, ['why_balance', 'fees_paid', 'largest', 'pending', 'statement_vs_live', 'peg', 'onchain_sent'], 'Approved starter questions, by ID, in display order.', S.content],
    'ai.retentionDays': ['integer', false, 30, 'How long the AI service keeps a conversation for audit. 0 keeps nothing.', S.ai]
  };

  function clone(v) {
    return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  function field(path) {
    var d = CATALOGUE[path];
    if (!d) throw new Error('WT.dataReq: unknown field ' + path);
    return { path: path, type: d[0], required: d[1], example: clone(d[2]), description: d[3], source: d[4] };
  }
  function entry(summary, notes, paths) {
    return { summary: summary, notes: notes, fields: paths.map(field) };
  }

  /* Reusable groups of paths. */
  var BALANCES = ['statement.opening', 'statement.closing'];
  var TX_CORE = ['transactions[].id', 'transactions[].seq', 'transactions[].type', 'transactions[].status', 'transactions[].postedAt', 'transactions[].amount'];
  var TX_TEXT = ['transactions[].description.en', 'transactions[].description.es', 'transactions[].counterparty.en', 'transactions[].counterparty.es'];
  var FEE_LINKS = ['transactions[].parentId', 'transactions[].feeKind', 'transactions[].fees[].amount', 'transactions[].fees[].asset', 'transactions[].fees[].kind', 'transactions[].fees[].feeTxId'];
  var ONCHAIN = ['transactions[].onchain.network', 'transactions[].onchain.hash', 'transactions[].onchain.confirmations', 'transactions[].onchain.verified', 'transactions[].onchain.explorerUri'];
  var EDU = [
    'content.education[].id',
    'content.education[].copyId',
    'content.education[].version',
    'content.education[].title.en',
    'content.education[].title.es',
    'content.education[].body.en',
    'content.education[].body.es',
    'content.education[].responsibleEntity',
    'content.education[].approvedAt',
    'content.education[].validity.from',
    'content.education[].validity.to'
  ];
  var VOICE = ['content.video.voiceover[].language', 'content.video.voiceover[].uri', 'content.video.voiceover[].scriptFingerprint', 'content.video.voiceover[].durationSeconds'];
  var CAPTIONS = ['content.video.captions[].language', 'content.video.captions[].uri', 'content.video.captions[].scriptFingerprint'];
  var AI_CORE = ['ai.enabled', 'ai.endpoint', 'ai.policyVersion', 'ai.inputFields', 'ai.guardrails.maxAnswerChars', 'ai.guardrails.blockedTopics', 'ai.guardrails.maskIdentifiers', 'ai.guardrails.citeRows', 'ai.disclaimer.en', 'ai.disclaimer.es'];
  var AI_TX = [
    'transactions[].id',
    'transactions[].type',
    'transactions[].status',
    'transactions[].rail',
    'transactions[].postedAt',
    'transactions[].amount',
    'transactions[].balanceAfter',
    'transactions[].description.en',
    'transactions[].fees[].amount',
    'transactions[].onchain.network',
    'transactions[].onchain.hash',
    'transactions[].onchain.confirmations',
    'transactions[].onchain.verified'
  ];
  /* What the customer types to the AI service is personal data too (see the notes). */
  var AI_QUESTION_NOTE =
    'The AI service receives only the fields in ai.inputFields and the customer’s own question. The question is sent as typed and may contain personal details, so it is covered by ai.retentionDays and the privacy notice. Descriptions must not include counterparty names.';

  WT.dataReq = {
    $common: entry(
      'The statement envelope every feature needs: who it is for (an internal ID and the first name used in greetings), which account and asset, the period and when the data was taken.',
      [
        'Amounts are signed integers in the asset’s minor units (precision 2: 100000 = 1,000.00). Never floats.',
        'Date-times are ISO 8601 with the UTC offset of statement.timezone.',
        'One asset per statement. Localised text comes as .en and .es; Spanish is needed only where Spanish is offered.',
        'InfoSlips validates the whole payload and withholds the statement if it does not reconcile.'
      ],
      [
        'statement.id',
        'statement.version',
        'statement.issueStatus',
        'statement.period.start',
        'statement.period.end',
        'statement.asOf',
        'statement.generatedAt',
        'statement.timezone',
        'statement.dateBasis',
        'statement.language',
        'customer.id',
        'customer.firstName',
        'account.maskedId',
        'account.label.en',
        'account.label.es',
        'asset.id',
        'asset.symbol',
        'asset.name.en',
        'asset.precision'
      ]
    ),

    summary: entry(
      'Opening and closing balances, plus a verified rate when a fiat equivalent is shown.',
      ['InfoSlips computes the net change and the fiat equivalent.', 'The fiat equivalent appears only when the rate is verified and has a source and a time.'],
      BALANCES.concat(['account.walletMasked', 'asset.fiat.currency', 'asset.fiat.rate', 'asset.fiat.source', 'asset.fiat.at', 'asset.fiat.verified'])
    ),

    video: entry(
      'The customer’s first name, balances and transactions, the approved script version, and any recorded voiceover or captions with their script fingerprint.',
      [
        'InfoSlips builds the 60-second script from the approved template and the statement figures, then finds the largest movement and the incoming and outgoing totals itself.',
        'A recording plays only when its script fingerprint matches the statement’s own script. Otherwise the device voice narrates, and captions and a transcript are always available.',
        'Narration with the device voice stays on the device: no statement figures leave it.'
      ],
      ['customer.firstName']
        .concat(BALANCES, ['transactions[].id', 'transactions[].type', 'transactions[].status', 'transactions[].postedAt', 'transactions[].amount', 'transactions[].description.en', 'transactions[].description.es'])
        .concat(['content.video.scriptVersion', 'content.video.poster.uri'], VOICE, CAPTIONS)
    ),

    journey: entry(
      'Opening and closing balances and every posted transaction with its type, so each journey step can be totalled.',
      [
        'InfoSlips derives each step (deposits, transfers in, transfers out, redemptions, fees) from transaction types. No step total is typed in.',
        'YES and InfoSlips agree the mapping from YES ledger codes to these five types once, not per statement.'
      ],
      BALANCES.concat(TX_CORE)
    ),

    why: entry(
      'Posted transactions with types, descriptions and fee links, so the statement can explain what moved the balance.',
      ['InfoSlips writes the explanation from approved sentence templates and computed totals. Nothing is generated freely.'],
      BALANCES.concat(TX_CORE, ['transactions[].description.en', 'transactions[].counterparty.en', 'transactions[].parentId', 'transactions[].feeKind'])
    ),

    'running-balance': entry(
      'The opening balance and every posted transaction in ledger order, with the balance YES recorded after each one.',
      ['InfoSlips recomputes the running balance from the opening balance and checks it against balanceAfter on every row.', 'Pending transactions are never plotted.'],
      BALANCES.concat(TX_CORE, ['transactions[].balanceAfter', 'transactions[].description.en'])
    ),

    fees: entry(
      'Fee lines and the transactions they belong to, linked both ways, plus a link to the fee schedule.',
      ['InfoSlips totals the fees and groups them by kind.', 'Fees in another asset are listed separately and never subtracted from the token balance.'],
      ['transactions[].id', 'transactions[].type', 'transactions[].status', 'transactions[].postedAt', 'transactions[].amount', 'transactions[].description.en'].concat(FEE_LINKS, ['content.feeSchedule.uri'])
    ),

    largest: entry(
      'Posted transactions with amounts, dates and descriptions.',
      ['InfoSlips picks the largest posted movement by size. Fee lines are excluded.'],
      ['transactions[].id', 'transactions[].type', 'transactions[].status', 'transactions[].postedAt', 'transactions[].amount', 'transactions[].description.en', 'transactions[].description.es', 'transactions[].counterparty.en']
    ),

    explorer: entry(
      'Every transaction in the period, posted or not, with the fields customers search, filter and sort by.',
      ['Search, filters, sorting and the CSV export all run in the browser. Nothing goes back to YES.', 'Include transactions that were pending, failed or unknown at the cut-off, so the list is complete.'],
      TX_CORE.concat(['transactions[].rail', 'transactions[].method', 'transactions[].initiatedAt', 'transactions[].asset', 'transactions[].balanceAfter'], TX_TEXT, ['transactions[].memo', 'transactions[].reference'])
    ),

    detail: entry(
      'Everything shown in one transaction’s detail: both dates, reference, balance after, fees, notes, masked parties and verified on-chain details.',
      ['YES masks account numbers and wallet addresses before sending them. InfoSlips never unmasks them.', 'On-chain details appear only when verified is true.'],
      [
        'transactions[].id',
        'transactions[].type',
        'transactions[].status',
        'transactions[].rail',
        'transactions[].method',
        'transactions[].initiatedAt',
        'transactions[].postedAt',
        'transactions[].amount',
        'transactions[].balanceAfter',
        'transactions[].reference',
        'transactions[].description.en',
        'transactions[].counterparty.en',
        'transactions[].memo'
      ].concat(FEE_LINKS, ['transactions[].notes[].en', 'transactions[].notes[].es'], ONCHAIN)
    ),

    pending: entry(
      'Transactions not posted at the cut-off, with their status and when they started.',
      ['Pending transactions have postedAt and balanceAfter set to null. InfoSlips lists them but never counts them in a balance.', 'If one completes later, it appears on the next statement.'],
      ['transactions[].id', 'transactions[].type', 'transactions[].status', 'transactions[].initiatedAt', 'transactions[].postedAt', 'transactions[].amount', 'transactions[].balanceAfter', 'transactions[].description.en', 'transactions[].notes[].en', 'statement.asOf']
    ),

    'explain-ai': entry(
      'The statement totals and transaction fields sent to YES’s governed AI service (including the balance after each transaction and any verified network reference), with its guardrails, disclaimer and retention.',
      [
        AI_QUESTION_NOTE,
        'A button sends the fields for the selected figure or transaction and the statement totals. The balance before a transaction is its balanceAfter minus its amount; unverified on-chain details are never sent.',
        'Answers must cite the transaction IDs they used. If the service is off or fails, the statement falls back to approved template explanations.'
      ],
      AI_CORE.concat(['ai.retentionDays'], BALANCES, AI_TX)
    ),

    inquiry: entry(
      'The case-management endpoint, the reasons and reply channels YES accepts, and any inquiries already open on a transaction.',
      [
        'The inquiry is sent through the customer’s authenticated YES session. The form never asks for contact details.',
        'InfoSlips offers only the reasons that fit each transaction, such as “It’s still pending” for a pending one.'
      ],
      [
        'support.inquiry.enabled',
        'support.inquiry.endpoint',
        'support.inquiry.reasons',
        'support.inquiry.channels',
        'support.inquiry.responseTargetDays',
        'support.cases[].txId',
        'support.cases[].ref',
        'support.cases[].status',
        'support.cases[].openedAt',
        'customer.contact.emailMasked',
        'customer.contact.phoneMasked',
        'transactions[].id',
        'transactions[].reference',
        'transactions[].status',
        'transactions[].type',
        'transactions[].amount',
        'transactions[].postedAt',
        'transactions[].description.en',
        'transactions[].counterparty.en'
      ]
    ),

    assistant: entry(
      'The statement fields the assistant may use, the AI guardrails and disclaimer, approved starter questions and the human-help route.',
      [
        AI_QUESTION_NOTE,
        'Questions outside the statement get an honest “I can only answer questions about this statement” and the support contacts.'
      ],
      AI_CORE.concat(['ai.suggestedQuestions', 'ai.retentionDays'], BALANCES, AI_TX, ['support.phone', 'support.email'])
    ),

    basics: entry(
      'Approved, versioned explanations of key terms in each language, with who owns them and when they are valid.',
      ['InfoSlips shows an explanation only when it has the customer’s language and the statement cut-off falls inside its validity window.', 'Examples inside explanations use the customer’s own figures, filled in by InfoSlips.'],
      EDU.concat(['asset.unitLabel.en', 'asset.unitLabel.es'])
    ),

    'live-balance': entry(
      'The approved explanation of statement versus live balance and, optionally, the live balance with its time and a link to the app.',
      ['The live balance is optional. When supplied, it sits in its own timestamped area and never changes statement figures.', 'Pending transactions at the cut-off explain most of the difference; InfoSlips lists them from the transactions.'],
      ['account.liveBalance.amount', 'account.liveBalance.at', 'account.liveBalance.appUri', 'content.education[].id', 'content.education[].copyId', 'content.education[].body.en', 'content.education[].body.es', 'transactions[].status', 'transactions[].amount']
    ),

    transparency: entry(
      'Verified transparency facts with source, date, owner and validity, and verified on-chain details for the sample reference.',
      ['A fact that is unverified or past its validity is hidden, and the page says the information is unavailable.', 'Links go only to approved YES or issuer pages.'],
      [
        'content.issuer.name',
        'content.evidence[].id',
        'content.evidence[].copyId',
        'content.evidence[].value.en',
        'content.evidence[].value.es',
        'content.evidence[].uri',
        'content.evidence[].source',
        'content.evidence[].date',
        'content.evidence[].responsibleEntity',
        'content.evidence[].validity.to',
        'content.evidence[].verified'
      ].concat(ONCHAIN)
    ),

    download: entry(
      'The customer’s full name and mailing address, approved disclosures, issuer name and logo for the statement of record, plus the transaction fields in the CSV.',
      [
        'InfoSlips builds the PDF, the print version and the CSV from the same data. Production files carry no demo watermark.',
        'The CSV lists every transaction, including those not in the balance, with the statement facts on each row.'
      ],
      ['customer.displayName', 'customer.address[]', 'content.disclosures.en', 'content.disclosures.es', 'content.issuer.name', 'brand.logo.uri', 'brand.logo.alt', 'preferences.paperSize', 'document.recordRetentionYears'].concat(TX_CORE, [
        'transactions[].initiatedAt',
        'transactions[].balanceAfter',
        'transactions[].reference',
        'transactions[].description.en',
        'transactions[].counterparty.en'
      ])
    ),

    'help-record': entry(
      'Support contacts and hours, the feedback endpoint and how long YES keeps the statement of record.',
      ['The statement-record facts (ID, version, period, cut-off, time zone, date basis) come from the common envelope.'],
      ['support.phone', 'support.email', 'support.hours.en', 'support.hours.es', 'support.chatAvailable', 'support.feedback.enabled', 'support.feedback.endpoint', 'document.recordRetentionYears']
    ),

    integrity: entry(
      'Balances, ordered transactions with recorded running balances and fee links, YES’s own control totals, and where to report a statement that fails its checks.',
      [
        'Before showing anything, InfoSlips checks unique IDs, integer amounts, one asset, the period, opening + movements = closing, every running balance, categories and fee links.',
        'If any check fails, the statement is withheld and reported to integrity.alertEndpoint, so YES can correct and reissue it. Nothing is adjusted to make it add up.'
      ],
      BALANCES.concat(TX_CORE, [
        'transactions[].asset',
        'transactions[].balanceAfter',
        'transactions[].parentId',
        'transactions[].fees[].amount',
        'transactions[].fees[].feeTxId',
        'statement.controlTotals.postedCount',
        'statement.controlTotals.netMovement',
        'statement.correction.supersedesVersion',
        'statement.correction.reason.en',
        'integrity.alertEndpoint'
      ])
    ),

    language: entry(
      'The approved English and Spanish copy bundle, locale tags, glossary and the Spanish versions of YES-supplied text.',
      [
        'The statement opens in statement.language. The customer can switch at any time; memos stay as written.',
        'When a Spanish field is missing, InfoSlips falls back to the approved template for that type, then to English.'
      ],
      [
        'content.i18n.bundleVersion',
        'content.i18n.locales',
        'content.i18n.fallbackLanguage',
        'content.glossary[].copyId',
        'content.glossary[].term.en',
        'content.glossary[].term.es',
        'content.glossary[].definition.en',
        'content.glossary[].definition.es',
        'account.label.es',
        'transactions[].description.es',
        'transactions[].counterparty.es',
        'transactions[].notes[].es',
        'content.disclosures.es',
        'support.hours.es'
      ]
    ),

    theme: entry(
      'YES brand colours, logos for light and dark backgrounds, the brand font and the customer’s saved theme.',
      ['Without a saved theme the statement follows the device. Print and PDF are always light.', 'InfoSlips checks every brand colour for contrast in both themes before release.'],
      ['preferences.theme', 'brand.logo.uri', 'brand.logo.darkUri', 'brand.logo.alt', 'brand.colors.primary', 'brand.colors.primaryDark', 'brand.colors.accent', 'brand.font.family', 'brand.font.uri']
    ),

    accessibility: entry(
      'Accessibility preferences, the UserWay account, the accessibility statement link, and captions and voiceover assets with their script fingerprint.',
      [
        'The statement is designed to meet WCAG 2.2 AA without extra data. These fields add YES’s widget, preferences and alternative formats.',
        'Captions and voiceover must carry the same script fingerprint as the statement, or InfoSlips uses its own captions and the device voice.'
      ],
      ['accessibility.userway.enabled', 'accessibility.userway.accountId', 'accessibility.statementUri', 'preferences.accessibility.alternateFormat', 'preferences.accessibility.reducedMotion', 'brand.logo.alt'].concat(CAPTIONS, VOICE)
    )
  };
})(window.WT = window.WT || {});
