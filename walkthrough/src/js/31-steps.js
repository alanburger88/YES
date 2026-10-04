/*
 * 31-steps.js — the 22 tour steps (SPEC section 6). Owner: steps.
 *
 * WT.steps[featureId] = {
 *   id,
 *   what:          'What it is' (2–3 sentences),
 *   valueYes:      3–4 bullets, the value for YES,
 *   valueCustomer: 3–4 bullets, the value for the customer,
 *   tryIt:         what to do in the statement,
 *   setup:         WT.driver actions, run in order (see 30-driver.js),
 *   target:        { desktop: [selectors], phone: [selectors] }, first visible match wins,
 *   shot:          optional screenshot tweaks for scripts/shots.mjs:
 *                  { pad: 16 | { top, right, bottom, left },
 *                    selector: [selectors to frame instead of the target; their boxes are unioned],
 *                    clip: { top, height, left, width } (px, relative to the framed box),
 *                    maxRatio (height ÷ width, default 2.2; taller boxes are cut from the top),
 *                    height (viewport height for this shot, default 900; drawers fill it) }
 * }
 * WT.stepIds is the tour order (from WT.features when present).
 *
 * Text conventions: plain text (no HTML, no Markdown). Labels the reader can
 * find in the statement are wrapped in “curly quotes”, so the tour may style
 * them. Setups use the statement's own deep links ({ route }) where one exists:
 * the driver replaces the frame's address, so a step never adds a history
 * entry, and the statement's own buttons never call history.back() on the tour.
 *
 * tests/30-steps.test.mjs verifies every setup and target in the statement at
 * 880×900, 390×844 and 1480×836 (light and dark; Next, Back and jump order) and
 * in a same-origin iframe at the tour's frame sizes (870×836 and 390×440).
 * scripts/shots.mjs runs the same setups at 1280×900 for the screenshots.
 */
(function (WT) {
  'use strict';

  var ASK_TEXT = '#assistant-drawer[open] .asst-turn:last-child .asst-ans__text';
  var ASK_ANSWER = '#assistant-drawer[open] .asst-turn:last-child .asst-ans';
  // the masthead, the page heading and the balance card: the whole statement at a glance
  var MAST_FRAME = ['#masthead .masthead__bar', '#masthead .nav__list', '#overview-root .ov-head', '#overview-root .ov-balance'];
  var ASK_FRAME = ['#assistant-drawer[open] .asst__head', '#assistant-drawer[open] .asst-turn:last-child .asst-you', ASK_TEXT];

  var STEPS = [
    {
      id: 'summary',
      what:
        'The first thing a customer sees: the closing balance in tokens, the exact moment it was taken, and how much it changed since the opening balance. A reference US-dollar value sits beside it, always with its rate, source and time. “Statement details” holds the statement ID and the masked account and wallet numbers.',
      valueYes: [
        'Answers “what do I hold, and as of when?” before the customer has to ask, so fewer routine questions reach support.',
        'The US-dollar value appears only with its rate, source and time, labelled “Illustrative” and “not a guarantee of value”. YES never implies a promise it can’t keep.',
        'An exact as-of time and masked account and wallet numbers make it a dependable record for complaints and audits.',
        'A personal greeting (“Hello, Sam”) makes the statement feel like YES speaking to the customer, not a system printout.'
      ],
      valueCustomer: [
        'See what you hold and how it changed in seconds, with no maths.',
        'Know exactly when the balance was taken, so a difference from the app today makes sense.',
        'Get a feel for the value in US dollars, with the rate and its source spelled out.',
        'Your account and wallet numbers stay masked, so the statement is safer to keep and share.'
      ],
      tryIt:
        'Start at the top of the Overview. The balance is shown in tokens, with the time it was taken, the change since the opening balance and a reference US-dollar value. Open “Statement details” to see the statement ID and the masked account and wallet numbers.',
      setup: [{ route: '#/overview' }],
      target: {
        desktop: ['#overview-root .ov-balance__grid', '#overview-root .ov-balance'],
        phone: ['#overview-root .ov-balance__grid', '#overview-root .ov-balance']
      },
      shot: { pad: 16 }
    },
    {
      id: 'video',
      what:
        'A one-minute animated walkthrough of the customer’s own statement: a personal greeting, the opening and closing balance, the largest movement, how to inspect a transaction and where to get help. It is drawn in the page from the statement’s own figures, so it always matches them. It never plays on its own, and it has captions (on by default), chapters, a transcript and full screen.',
      valueYes: [
        'A short, personal message from YES with every statement: a reason for customers to open it and engage.',
        'The figures come straight from the statement data, so the video can never contradict the statement.',
        'It shows customers how to help themselves (select a step, open a transaction, ask a question) before they think of calling.',
        'Captions, a transcript and a recorded Spanish voiceover make it inclusive from day one.'
      ],
      valueCustomer: [
        'Get the story of your month in one minute, in plain words.',
        'Watch only if you want to: it never starts by itself.',
        'Read along with captions, skip to a chapter, or read the transcript instead.',
        'Hear it in English or Spanish.'
      ],
      tryIt:
        'Press “Play” for the one-minute tour of this statement (it has sound). Captions are on, and you can jump to any chapter or open the “Transcript”. Switch to “Español” at the top of the statement to hear the recorded Spanish voiceover.',
      setup: [{ route: '#/overview' }, { call: 'overview.video.seek', args: [20, { play: false }] }],
      target: {
        desktop: ['#overview-root .ov-video', '#overview-root [data-vp-player]'],
        phone: ['#overview-root [data-vp-player]', '#overview-root .ov-video']
      },
      shot: { pad: 16 }
    },
    {
      id: 'journey',
      what:
        'The statement’s signature view: a path from the opening balance to the closing balance, grouped as incoming activity (deposits, incoming transfers) and outgoing activity and fees (outgoing transfers, redemptions, fees). Select any step and the exact transactions behind it appear, with a sum line that proves they add up. Here, “Outgoing transfers” is selected.',
      valueYes: [
        'Answers “where did my money go?” on the page, so customers don’t need to call to have their statement explained.',
        'Every step adds up in front of the customer, which builds trust and heads off disputes about totals.',
        '“Show in Transactions” opens the same rows in the full list, so customers keep exploring on their own.',
        'A visual centrepiece that sets the YES statement apart.'
      ],
      valueCustomer: [
        'See how you got from your opening to your closing balance at a glance.',
        'Check any step against the transactions that make it up.',
        'Prefer numbers? The same journey is written out as a sum (“In numbers”) and as a table.',
        'Explore freely: select another step, or clear the selection to see the whole journey again.'
      ],
      tryIt:
        'Select any step, such as “Outgoing transfers”. The transactions behind it appear with a sum line that matches the step. “Show in Transactions” opens the same rows in the full list. Select the step again, or “Clear selection”, to see the whole journey.',
      setup: [{ route: '#/overview/transfers_out' }, { wait: '#overview-root #ov-panel-section' }],
      target: {
        desktop: ['#overview-root #ov-journey-body', '#overview-root .ov-journey'],
        phone: ['#overview-root #ov-journey-body', '#overview-root .ov-journey']
      },
      shot: { pad: 16 }
    },
    {
      id: 'why',
      what:
        '“Explain this balance”, on the balance card, gives a short, plain-language account of what moved the balance: what added to it, what took away from it (including fees) and what is still pending and so not included. It lists the figures it used. Further down the Overview, the “Why it changed” section tells the same story with a chart, the fees and the largest movement.',
      valueYes: [
        'Answers “why is my balance different?” inside the statement, before it becomes a call or an email.',
        'Every sentence is built from the statement’s own figures, so the explanation always matches the record.',
        'Pending items are called out, so customers don’t mistake a timing difference for an error.',
        'In this demo the text is built from fixed sentence templates and labelled “Demo explanation”, so it never says more than the statement supports.'
      ],
      valueCustomer: [
        'Understand your balance in a few sentences, without working it out yourself.',
        'See exactly which figures the explanation used.',
        'Know what is still pending and why it isn’t in the balance yet.',
        'Ask a follow-up question, or reach a person, from the same place.'
      ],
      tryIt:
        'Select “Explain this balance” on the balance card. Ask YES opens with a short explanation of what added to the balance, what took away from it and what is still pending, with the figures it used. Further down the Overview, “Why it changed” shows the same story as a chart, the fees and the largest movement.',
      setup: [{ route: '#/overview' }, { call: 'assistant.open', args: [{ topic: 'balance' }] }],
      target: { desktop: [ASK_TEXT, ASK_ANSWER], phone: [ASK_TEXT, ASK_ANSWER] },
      shot: { pad: { bottom: 16 }, selector: ASK_FRAME, height: 1100 }
    },
    {
      id: 'running-balance',
      what:
        'A step chart of the balance after every posted transaction, with incoming and outgoing movements told apart by marker shape, not just colour. Move along the chart, or tab through its points, to see each movement; select a point to open its transaction. A summary sentence and a table give the same figures in words.',
      valueYes: [
        'Shows when the balance moved, not just how much, which answers “when did that leave my account?” without a call.',
        'Every point opens its transaction, steering customers to self-service.',
        'Accessible from the start: a summary sentence, a full table and keyboard-friendly points.',
        'Pending items are never plotted, so the chart always agrees with the statement balance.'
      ],
      valueCustomer: [
        'See your highest and lowest balance, and when they happened.',
        'Check the balance after any single movement.',
        'Use it with a mouse, touch, keyboard or screen reader, or read it as a table.',
        'Tell incoming from outgoing at a glance, by shape and icon as well as colour.'
      ],
      tryIt:
        'Move along the chart, or tab to its points, to see each movement and the balance after it. Select a point to open that transaction. “Show the chart data as a table” lists the same figures.',
      setup: [{ route: '#/overview' }],
      target: { desktop: ['#overview-root .ov-chartcard'], phone: ['#overview-root .ov-chartcard'] },
      shot: { pad: 16 }
    },
    {
      id: 'fees',
      what:
        'Every fee for the period in one card: the total, how many there were, and each fee with what it was for and when. Each fee is its own ledger line, linked to the transaction it belongs to. Fees in another asset would be listed separately and never subtracted from the balance.',
      valueYes: [
        'Clear, up-front fee disclosure, which means fewer questions and complaints about charges.',
        'Customers and support see the same breakdown, with every fee linked to its transaction.',
        'Supports fair, transparent communication of charges.',
        '“Explain with AI” and “Show fees in the journey” answer the follow-up question on the spot.'
      ],
      valueCustomer: [
        'Know exactly what you paid, and for what.',
        'No hunting through transactions: every fee is in one place.',
        'Open any fee to see the transaction it belongs to.',
        'See how fees fit into your balance journey.'
      ],
      tryIt:
        'See every fee for the period, what each one was for and the total. Select a fee to open it and the transaction it belongs to, or choose “Show fees in the journey”.',
      setup: [{ route: '#/overview' }],
      target: { desktop: ['#overview-root .ov-fees'], phone: ['#overview-root .ov-fees'] },
      shot: { pad: 16 }
    },
    {
      id: 'largest',
      what:
        'An “Insight” card that names the biggest single movement of the period (fees aside), with its amount, date and description. One click opens the transaction, and another explains what token units are.',
      valueYes: [
        'Surfaces the movement that shaped the balance most, before the customer asks about it.',
        'A useful, personal insight that gives customers a reason to look closer.',
        'Sets a pattern YES can reuse for other insights, each backed by the statement’s data.'
      ],
      valueCustomer: [
        'Spot the biggest change to your balance straight away.',
        'Check it with one click.',
        'Learn what token units are, right where you need it.'
      ],
      tryIt:
        'The statement picks out the biggest movement of the period. Select “View this transaction” to see its details, or “What are token units?” for a short explanation.',
      setup: [{ route: '#/overview' }],
      target: { desktop: ['#overview-root .ov-insight'], phone: ['#overview-root .ov-insight'] },
      shot: { pad: 16 }
    },
    {
      id: 'explorer',
      what:
        'Every transaction in the period, posted or not, in a compact table or, on small screens, easy-to-read cards. Search by description, name, memo, reference, ID or amount; filter by date, direction, type, status, rail or amount; and sort by posted date, initiated date or amount. Active filters show as chips you can remove, with a filtered total and “Download CSV — current view”.',
      valueYes: [
        'Customers find a transaction themselves instead of calling to ask about it.',
        'Posted and initiated dates are both shown, so timing questions answer themselves.',
        'Customers who reconcile in a spreadsheet download exactly what they see, with no manual requests.',
        'A familiar, app-like experience that encourages customers to use the digital statement.'
      ],
      valueCustomer: [
        'Find any transaction in seconds by name, amount or reference.',
        'Narrow the list to exactly what you need, and see its total.',
        'Works as well on a phone as on a laptop.',
        'Download what you see as a spreadsheet.'
      ],
      tryIt:
        'Type a name, amount or reference into “Search transactions” (this step searched for “Daniel”). Use the filters to narrow by date, direction, type, status, rail or amount, and “Sort by” to change the order. Each filter shows as a chip you can remove.',
      setup: [{ route: '#/transactions' }, { call: 'explorer.applyFilter', args: [{ q: 'Daniel' }, { reset: true, focus: false }] }],
      target: { desktop: ['#transactions-root .tx-bar', '#transactions-root'], phone: ['#transactions-root .tx-bar', '#transactions-root'] },
      shot: {
        pad: 16,
        selector: ['#transactions-root .tx-head', '#transactions-root .tx-bar', '#tx-results', '#tx-filter-panel .tx-fs:nth-of-type(2)']
      }
    },
    {
      id: 'detail',
      what:
        'Everything about one transaction in one place: the amount and status, when it was started and when it posted, the type, the rail and method, the counterparty, the description and memo, and the balance after it. The reference and transaction ID each have “Copy”, and a fee shows as its own linked line. Account numbers are masked, and screen readers hear them as “ending in 4821”.',
      valueYes: [
        'Gives customers the facts support would otherwise look up for them: references, both dates and linked fees.',
        'Exact references and IDs, copied in one tap, make any follow-up faster and more accurate.',
        'Masked identifiers protect customers while still letting them recognise the account.',
        '“Explain with AI” and “Ask about this transaction” sit right here, at the moment of doubt.'
      ],
      valueCustomer: [
        'See exactly what happened, when it started and when it posted.',
        'Copy a reference in one tap if you need to quote it.',
        'Recognise the account by its last digits, with the full number kept private.',
        'Move to the previous or next transaction without closing the details.'
      ],
      tryIt:
        'Select any transaction to open its details. Look for both dates, the reference with “Copy”, the balance after it and the fee as its own linked line (“Open fee line”). Use the arrows to move to the previous or next transaction.',
      setup: [{ route: '#/transactions/TX-260920-0900' }, { wait: '#tx-dialog[open] #tx-dialog-title' }],
      target: { desktop: ['#tx-dialog[open]'], phone: ['#tx-dialog[open]'] },
      shot: { pad: 0, height: 1100 }
    },
    {
      id: 'pending',
      what:
        'Movements that started but had not posted by the cut-off are listed, but never counted in the balance, the journey or the chart, and the statement says so. On the Overview, a notice in the balance card reads “1 pending transaction (−30.00 EXUSD) is not included in this balance.” In Transactions the row is marked “Not included in statement balance”.',
      valueYes: [
        'Explains a timing difference that would otherwise look like an error, before the customer calls.',
        'Fewer disputes about “missing” or double-counted money.',
        'A pending redemption reads “Redemption requested”, never “Redeemed”, so the statement never overstates what happened.',
        'Keeps the statement of record accurate and easy to defend.'
      ],
      valueCustomer: [
        'Know what is still on its way, and that it isn’t lost.',
        'Understand why your statement and your app may differ.',
        'See when it started, and where it will appear if it completes: on your next statement.'
      ],
      tryIt:
        'A redemption requested on the last evening of the period hadn’t settled by the cut-off. The statement lists it but leaves it out of the balance, and says so. Select “View transaction” or “Explain with AI” to see why.',
      setup: [{ route: '#/overview' }],
      target: { desktop: ['#overview-root .ov-notin'], phone: ['#overview-root .ov-notin'] },
      shot: { pad: 16, selector: ['#overview-root .ov-balance__grid', '#overview-root .ov-notin'] }
    },
    {
      id: 'explain-ai',
      what:
        'Every “Explain with AI” button gives a short, plain-language explanation of what it sits next to. For a transaction, it covers what happened, the balance before and after, how the money moved, any linked fee and any network reference, with the figures and rows it used. The buttons sit on the balance, the journey, the chart, fees, the pending notice, Understand topics and every transaction.',
      valueYes: [
        'Puts a clear answer next to every figure, at the moment a question comes up.',
        'Answers show their working (figures and rows), so customers can trust them.',
        'In this demo answers are worked out in the browser and nothing is sent. Production would use a governed AI service with a privacy notice and an audit trail.',
        'Positions YES as a modern, helpful brand in digital money.'
      ],
      valueCustomer: [
        'Understand any transaction in plain words, without searching for help.',
        'See the figures and transactions behind each answer.',
        'Ask about the transaction, or talk to a person, from the same place.'
      ],
      tryIt:
        'Open any transaction and select “Explain with AI”. You get a short explanation built from that transaction’s own figures, with the rows it used and “Ask about this transaction”. Look for the same button on the balance card, the journey, the chart, fees and Understand topics.',
      setup: [{ route: '#/transactions' }, { call: 'assistant.open', args: [{ topic: 'transaction', id: 'TX-260909-2051' }] }],
      target: { desktop: [ASK_TEXT, ASK_ANSWER], phone: [ASK_TEXT, ASK_ANSWER] },
      shot: { pad: { bottom: 16 }, selector: ASK_FRAME, height: 1200 }
    },
    {
      id: 'inquiry',
      what:
        'A guided, four-step way to ask YES about one transaction: Transaction, Details, Review and Confirmation. The transaction and its reference are filled in, only reasons that fit it are offered, and the customer can add a note and choose how YES should reply. It asks for no contact details, keeps a draft if the customer stops halfway, and explains how an inquiry differs from a formal dispute or a fraud report.',
      valueYes: [
        'Inquiries arrive with the transaction, reference and reason attached, so they are quicker to resolve.',
        'Keeps simple questions out of the formal dispute process, while making the route to a dispute or fraud report clear.',
        'Asks for no contact details and warns against sharing passwords or account numbers, which lowers fraud and data risk.',
        'A self-service channel that can replace a phone call.'
      ],
      valueCustomer: [
        'Raise a question in a minute, right where you spotted the problem.',
        'Nothing to fill in from scratch: the transaction is already there.',
        'Choose how YES replies: in-app message, or the email or phone number already on file.',
        'Stop halfway and pick up where you left off.'
      ],
      tryIt:
        'In a transaction’s details, select “Ask about this transaction”. Check the transaction, pick a reason, add a note if you like, choose how YES should reply, then review and submit. In this demo nothing is sent: you get a fictional reference.',
      setup: [{ route: '#/transactions' }, { call: 'inquiry.start', args: ['TX-260924-1327'] }, { wait: '#inquiry-dialog[open] #inquiry-dialog-title' }],
      target: { desktop: ['#inquiry-dialog[open]'], phone: ['#inquiry-dialog[open]'] },
      shot: { pad: 0 }
    },
    {
      id: 'assistant',
      what:
        'Ask YES answers questions about this statement: customers pick one of seven suggested questions or type their own. Every answer shows the figures and transactions it used, with “Show these rows in Transactions”, “Was this helpful?” and “Talk to a person”. It is open about its limits: it can’t move money, give investment advice or see the live account.',
      valueYes: [
        'Handles routine statement questions at any hour, taking load off support.',
        'Grounded in the statement and honest about its limits, so it builds trust instead of risk.',
        '“Was this helpful?” shows YES which answers work and where customers still struggle.',
        'In this demo nothing is sent. In production it would use a governed AI service with a privacy notice, a retention policy and an audit trail.'
      ],
      valueCustomer: [
        'Ask in your own words and get an answer about your own statement.',
        'See the numbers behind every answer.',
        'Reach a person whenever you want.',
        'Ask in English or Spanish, on a phone or a laptop.'
      ],
      tryIt:
        'Select “Ask YES” at the top of the statement. Pick a suggested question or type your own, such as “What did I pay in fees?”. Each answer shows the figures and transactions it used, and “Talk to a person” is always there.',
      setup: [{ route: '#/overview' }, { call: 'assistant.ask', args: ['fees_paid'] }],
      target: { desktop: ['#assistant-drawer[open]'], phone: ['#assistant-drawer[open]'] },
      shot: { pad: 0, height: 860 }
    },
    {
      id: 'basics',
      what:
        'Short, plain-language explanations of the seven terms the statement uses: token units, the US-dollar equivalent, on-chain versus internal transfers, transaction status, fees, redemption, and statement versus live balance. Together they are the statement’s glossary. Each has an example from the customer’s own figures, an “Explain with AI” button and a content record (ID, version, source, owner and validity).',
      valueYes: [
        'Explains new terms in context, which lowers the barrier to using stablecoins with YES.',
        'Fewer “what does this mean?” questions for support.',
        'Each explanation carries a content record, so YES can approve, own and expire the wording.',
        'Examples use the customer’s own figures, which makes the learning relevant.'
      ],
      valueCustomer: [
        'Learn the terms you need, in plain words.',
        'See each idea with an example from your own statement.',
        'Read as much or as little as you like: one topic, or all of them.'
      ],
      tryIt:
        'Open any topic, such as “Token units”, for a short explanation with an example from your own statement. “Expand all” opens every topic, and “Explain with AI” asks Ask YES about it.',
      setup: [{ route: '#/understand/token_units' }],
      target: { desktop: ['#understand-root #und-basics'], phone: ['#understand-root #und-topic-token_units', '#understand-root #und-basics'] },
      shot: { pad: 16 }
    },
    {
      id: 'live-balance',
      what:
        'A side-by-side explanation of why the statement balance can differ from the balance in the app today. The statement snapshot is fixed for the period. Live account data belongs in a separate, timestamped area (not connected in this demo), and a short list shows what explains the difference, such as the pending redemption.',
      valueYes: [
        'Answers “why doesn’t my statement match my app?” before it becomes a complaint.',
        'Keeps the statement of record and live data clearly apart, as a record should.',
        'Links straight to the transaction that explains the gap.'
      ],
      valueCustomer: [
        'Understand how two different balances can both be right.',
        'Know which balance is the record for the period.',
        'See exactly what would change your live balance.'
      ],
      tryIt:
        'Compare the statement snapshot, fixed as of 30 September, with the separate live-balance area (not connected in this demo). The panel lists what explains the difference, such as the pending redemption.',
      setup: [{ route: '#/understand/live' }],
      target: { desktop: ['#understand-root #und-live'], phone: ['#understand-root #und-live'] },
      shot: { pad: 16 }
    },
    {
      id: 'transparency',
      what:
        'A panel for verified facts about the stablecoin: the issuer, the reserve report, the attestation date, the redemption terms and a source link, each with its source, date and owner. In this demo they are placeholders, clearly labelled “Illustrative layout; no reserve assertion”. Just above, “On-chain reference” shows a sample network reference with its confirmations, “Copy” and “Show full hash”, and no explorer link.',
      valueYes: [
        'One governed place to publish reserve and issuer facts, with a source and date on each.',
        'Facts appear only when verified, so the statement never makes a claim YES can’t support.',
        'Builds confidence in the stablecoin itself, which supports adoption.',
        'On-chain references are shown with their verification status, never overstated.'
      ],
      valueCustomer: [
        'Know where to check what backs your stablecoin.',
        'See the source and date behind every fact.',
        'Find the network reference for an on-chain transfer when you need it.'
      ],
      tryIt:
        'See where verified facts about reserves and the issuer would appear, each with its source and date. They are placeholders in this demo. Just above, “On-chain reference” shows a sample network reference with “Copy” and “Show full hash”. Nothing links to a real blockchain explorer.',
      setup: [{ route: '#/understand/transparency' }],
      target: { desktop: ['#understand-root #und-transparency'], phone: ['#understand-root #und-transparency'] },
      shot: { pad: 16 }
    },
    {
      id: 'download',
      what:
        'Every way to keep the statement of record, side by side: a print layout (always light), a PDF file and a spreadsheet (CSV) with every transaction. The files are created on the customer’s device, in the current language, and nothing is sent. The same options sit under “Download or print” at the top of every page, and Transactions adds a CSV of the current view.',
      valueYes: [
        'Fewer requests for statement copies: customers keep their own.',
        'The same statement of record in every format, with its ID and page numbers, supports record-keeping and audits.',
        'Files are made on the device, so there is nothing extra to generate, store or send per customer.'
      ],
      valueCustomer: [
        'Keep a copy that suits you: paper, PDF or spreadsheet.',
        'Use the spreadsheet for budgeting, accounts or tax.',
        'Get your files instantly, even offline.'
      ],
      tryIt:
        'Choose “Download PDF” or “Download CSV — complete record”. The files are made on your device and nothing is sent. “Print statement” opens your browser’s print dialog. You’ll also find these under “Download or print” at the top of every page.',
      setup: [{ route: '#/help/record' }],
      target: {
        desktop: ['#help-root #help-record .help-dl', '#help-root #help-record'],
        phone: ['#help-root #help-record .help-dl', '#help-root #help-record']
      },
      shot: { pad: 10 }
    },
    {
      id: 'help-record',
      what:
        'Help brings support together: phone, email, hours and chat status (placeholders in this demo), and a plain explanation of three routes: a transaction inquiry, a formal dispute, and fraud or unauthorized activity. A one-question prompt asks “How clear was this statement?”. The statement record lists the ID, version, issue status (Original or Corrected), period, times, time zone and date basis; corrections are issued as a new version, never by changing the original.',
      valueYes: [
        'Sends customers to the right route first time: a question, a dispute or a fraud report.',
        '“How clear was this statement?” gives YES a simple, ongoing measure of clarity.',
        'A clear record with version and issue status makes corrections and audits straightforward.',
        'Contact details live in one place, so YES can update them without touching the features.'
      ],
      valueCustomer: [
        'Know how to reach YES, and when.',
        'Know which route fits your problem, so you get the right help faster.',
        'Find the facts that identify your statement when you need to quote them.',
        'Tell YES how clear the statement was in one tap.'
      ],
      tryIt:
        'See how a customer would reach YES, and how an inquiry differs from a formal dispute or a fraud report. Further down, rate how clear the statement was, and check its ID, version and dates under “Statement record”.',
      setup: [{ route: '#/help/contact' }],
      target: { desktop: ['#help-root #help-contact'], phone: ['#help-root #help-contact'] },
      shot: { pad: 16 }
    },
    {
      id: 'integrity',
      what:
        'Before showing anything, the statement runs nine checks on its own numbers, from unique IDs and exact amounts to “opening balance plus movements equals closing balance”, every running balance, and pending items kept out of the balance. Help shows the equation and “9 of 9 checks passed”. If any check fails, the statement is withheld rather than shown with wrong figures.',
      valueYes: [
        'A statement that doesn’t add up never reaches a customer, which protects YES from errors, complaints and corrections.',
        'A clear, testable control that compliance and auditors can see working.',
        'Fails safe: a mismatch is withheld and routed for correction, never hidden by rounding.',
        'Shows customers that YES checks its work, which builds trust.'
      ],
      valueCustomer: [
        'Trust that the figures add up: the statement checks itself.',
        'See the checks for yourself, in plain words.',
        'If something is ever wrong, you get a clear message, not wrong numbers.'
      ],
      tryIt:
        'Read the checks the statement ran on its own numbers. Select “Preview the exception state” to see what a customer would get if the numbers didn’t add up: the statement is withheld. “Return to the valid demo statement” brings it back.',
      setup: [{ route: '#/help/integrity' }],
      target: { desktop: ['#help-root #help-integrity'], phone: ['#help-root #help-integrity'] },
      shot: { pad: 16 }
    },
    {
      id: 'language',
      what:
        'The whole statement in English or Spanish, switchable at any time from the header (on a phone, from the Menu). Labels, explanations, dates and number formats all change (1,147.50 becomes 1.147,50), and so do the video with its recorded voiceover, the PDF, the CSV headings and Ask YES. The customer keeps their place, filters, open transaction and conversation.',
      valueYes: [
        'Serves Spanish-speaking customers fully, not with a partial translation.',
        'One statement, two languages: no second document to produce or keep in step.',
        'Supports fair treatment of customers who prefer Spanish.',
        'The same structure can take further languages.'
      ],
      valueCustomer: [
        'Read your statement in the language you’re most comfortable with.',
        'Switch at any time without losing your place.',
        'See numbers and dates the way you’re used to reading them.',
        'Watch the video and download the PDF in Spanish too.'
      ],
      tryIt:
        'The statement is now in Spanish. Switch between “English” and “Español” at the top (on a phone: “Menu”, then the language). Labels, dates, numbers, explanations and the video all change, and you stay exactly where you were.',
      setup: [{ route: '#/overview' }, { lang: 'es' }, { menu: true }],
      target: { desktop: ['#masthead .mast-wide .seg--lang'], phone: ['#mast-menu .mast-menu__pref', '#masthead [data-mast-menu]'] },
      shot: { pad: { bottom: 16 }, selector: MAST_FRAME }
    },
    {
      id: 'theme',
      what:
        'A light and a dark version of the whole statement, which follows the device setting until the customer chooses and then remembers their choice on that device. Print and PDF are always light. Colours come from replaceable brand slots, so YES’s final palette will carry into both themes.',
      valueYes: [
        'Matches what customers expect from a modern finance app.',
        'Brand colours sit in replaceable slots, so YES’s final palette applies to both themes without a redesign.',
        'Helps customers who find bright screens hard to read.'
      ],
      valueCustomer: [
        'Read comfortably at night or in low light.',
        'It follows your device automatically, or your own choice.',
        'Printouts and PDFs stay light and clear.'
      ],
      tryIt:
        'The statement has switched to the other theme. Select “Dark mode” (the moon button) at the top to switch back and forth; on a phone it is in the “Menu”. Until a customer chooses, the statement follows their device’s setting.',
      setup: [{ route: '#/overview' }, { theme: 'opposite' }, { menu: true }],
      target: { desktop: ['#masthead .mast-wide [data-theme-toggle]'], phone: ['#mast-menu .mast-menu__theme', '#masthead [data-mast-menu]'] },
      shot: { pad: { bottom: 16 }, selector: MAST_FRAME }
    },
    {
      id: 'accessibility',
      what:
        'Designed to meet WCAG 2.2 AA without add-ons: keyboard use, screen readers (masked numbers are read as “ending in 4821”), visible focus, reduced motion, zoom and reflow, a table behind every chart, and never relying on colour alone. On phones the layout adapts, with a Menu, full-screen panels and cards instead of tables. When online, the UserWay widget adds optional display and reading tools.',
      valueYes: [
        'Accessibility is built into every feature, not bolted on, which lowers legal and reputational risk.',
        'Serves more of YES’s customers well, including people who use screen readers, keyboards or large text.',
        'Works on any phone, so the statement goes wherever the customer is.',
        'UserWay adds display and reading tools on top of an accessible base. A formal WCAG 2.2 AA review comes before production.'
      ],
      valueCustomer: [
        'Use the statement your way: keyboard, screen reader, zoom or touch.',
        'Read every chart as a table or in words.',
        'Turn down motion if animation bothers you.',
        'A layout made for your phone, not a shrunken page.'
      ],
      tryIt:
        'Read what is built in: keyboard use, screen readers, visible focus, reduced motion, zoom, tables behind every chart and never relying on colour. Online, the UserWay button in the bottom-left corner adds more tools. Narrow the window, or open the link on a phone, to see the mobile layout.',
      setup: [{ route: '#/help/accessibility' }],
      target: { desktop: ['#help-root #help-accessibility'], phone: ['#help-root #help-accessibility'] },
      shot: { pad: 16 }
    }
  ];

  var map = {};
  STEPS.forEach(function (s) {
    map[s.id] = s;
  });
  WT.steps = map;
  WT.stepIds = (WT.features && WT.features.length ? WT.features : STEPS).map(function (f) {
    return f.id;
  });
})((window.WT = window.WT || {}));
