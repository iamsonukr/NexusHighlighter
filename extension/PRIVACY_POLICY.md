# NoteMark Privacy Policy

_Last updated: August 9, 2026_

This document describes what NoteMark ("the extension") collects, stores, and
transmits. It is written to satisfy the Chrome Web Store Privacy Policy and
Limited Use program policies. Host this page at a real, stable URL and link it
in the Chrome Web Store Developer Dashboard privacy field before submitting the
extension for review.

## What NoteMark's single purpose is

NoteMark lets you highlight and annotate text on webpages, and shows you those
highlights again when you revisit the page. That is the entire purpose of the
extension; everything it collects exists to serve that purpose.

## What is collected, and when

Nothing is collected just from visiting a page. NoteMark's content script runs
on webpages so it can offer the highlighting toolbar and restore any highlights
you have already made, but it does not record that you visited a page unless
you actually highlight something on it.

The moment you create a highlight, NoteMark stores locally on your device via
`chrome.storage.local`:

- The text you selected, plus a small amount of surrounding text used only to
  relocate the highlight if the page changes later
- Any note or tags you add to that highlight
- The page URL, title, and domain, recorded only for pages where you actually
  highlighted something
- Timestamps for creation and updates

This data never leaves your device except in the license verification case
described below.

## What is sent off your device, and to whom

1. License key verification. If you enter a license key to unlock Pro features,
   that key is sent to our backend at
   `https://nexusbackend-ookk.onrender.com/api/subscriptions/verify` to check
   whether it is currently valid. This happens when you activate a key, when
   you open the popup, and once each time you start your browser. No highlight,
   note, or browsing data is included in this request; only the license key and
   a fixed product identifier are sent.
2. Nothing else. NoteMark does not send your highlights, notes, tags, or
   browsing activity to us or to any third party. There is no analytics SDK, no
   ad network, and no third-party tracking code in this extension.

## Data we do not collect

- No account, email, or password; there is no login or signup in the extension
- No browsing history beyond pages you explicitly highlighted on
- No payment or financial information; billing happens entirely on our website,
  outside the extension
- No location, contacts, or health data

## How long data is kept, and how to delete it

Highlights, notes, and page records stay in `chrome.storage.local` until you
delete them via the sidebar or remove the extension. Deleting a highlight
removes it from the visible extension experience immediately and marks the
local record as deleted so a future sync feature can propagate that deletion.
Removing the extension clears its local extension storage.

## Limited Use disclosure

The use of information received from Chrome APIs by NoteMark will adhere to the
Chrome Web Store User Data Policy, including the Limited Use requirements: data
is used solely to provide the highlighting and annotation feature described
above, is not sold, and is not used for advertising.

## Contact

Contact: [add a support email or contact page before publishing].

## Changes to this policy

If NoteMark's data practices change, for example if cloud sync is added in a
future version, this page will be updated and the change will also be disclosed
in the extension's own interface before it takes effect, per the Chrome Web
Store Disclosure Requirements.
