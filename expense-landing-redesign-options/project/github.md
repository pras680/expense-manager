repo: pras680/expense-manager
branch: main
path: webapp/src

## Last sync
date: 2026-09-06T07:46:11Z

### Updated in this project
- Built "Expense Landing.dc.html": 3 redesign options for the home screen's top section (above the receipt list), in the Modernist design system.
- Removed the receipt list itself; each option ends in one large "View all receipts" CTA instead.
- Content grounded in the real logic: this-month hero figure + pace bar + assessment sentence (`lib/spendingInsights.ts`, `components/MonthOverview.tsx`), stat tiles (`components/StatTile.tsx`), and the auto-import review nudge (`pages/ReceiptsListPage.tsx`).

## Screen map
| Project screen | Repo source |
| --- | --- |
| Expense Landing.dc.html (top section options 1a/1b/1c) | webapp/src/pages/ReceiptsListPage.tsx, webapp/src/components/MonthOverview.tsx, webapp/src/components/StatTile.tsx, webapp/src/lib/spendingInsights.ts, webapp/src/components/NavBar.tsx, webapp/index.html
