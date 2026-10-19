# Kuro Market

Tracks prices on the [Kuro market](https://playkuro.com/market) for your favourite items, every 30 minutes, even when your PC is off, and shows them on a desktop dashboard.

## Setup (once)

Double-click **`setup.bat`**. It installs what's missing, asks you to log in to GitHub once in your browser, links it to your GitHub repo (it creates one called `kuro-market` if none is linked yet), and starts the price checks. When it's done you'll have a **Kuro Market** shortcut on your desktop.

## Using it

- Double-click **Kuro Market** on your desktop. The dashboard opens in your browser.
- Each card shows an item's **cheapest** real listing (big number, solid line) and its **typical** asking price (median, dashed line), in Perfect Pitch.
- Click a card to see the full chart (24h / 7d / 30d / All), the current listings, switch its rule, or remove it.
- Use the search box to look up any item and **Add to favourites**.

## What counts as a real listing

- **per unit** (Hyper skills): price per single item; sellers with only 1 in stock are ignored.
- **9999 stack** (Approvals, Fragments, everything else): only stacks of 9,999 count.

New items get "per unit" if their name contains "Hyper", otherwise "9999 stack". You can switch it per item.

## How it works

GitHub runs `tracker/check.py` every ~30 minutes (sometimes a few minutes late) and saves results to `data/history/`. The dashboard (`app/`) pulls the latest data from GitHub when you open it.
