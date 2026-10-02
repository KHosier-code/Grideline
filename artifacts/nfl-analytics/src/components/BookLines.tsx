import type { ConsumerBookLines } from '@workspace/api-client-react';
import { bookShort, pointText, priceText, shopLines, type BetKey } from '@/lib/line-shopping';

/** One line under a game card: where each side's number is better, when DraftKings and FanDuel disagree. */
export function BestNumbers({ books, home, away }: { books: ConsumerBookLines[]; home: string; away: string }) {
  const { best, differs } = shopLines(books);
  if (books.length < 2 || !differs) return null;
  const items: Array<[string, BetKey]> = [[away, 'awaySpread'], [home, 'homeSpread'], ['Over', 'over'], ['Under', 'under']];
  const parts = items.flatMap(([label, key]) => {
    const offer = best[key];
    if (!offer?.differs || offer.best.point === null) return [];
    return [`${label} ${key.endsWith('Spread') ? pointText(offer.best.point) : offer.best.point} ${bookShort(offer.best.sportsbook)}`];
  });
  if (!parts.length) return null;
  return <p className="gl-gc-foot gl-best-number"><b>Best number</b> {parts.join(' · ')}</p>;
}

/** DraftKings and FanDuel side by side, the better number for each bet highlighted. */
export function BookTable({ books, home, away }: { books: ConsumerBookLines[]; home: string; away: string }) {
  if (!books.length) return null;
  const { best } = shopLines(books);
  const rows: Array<[string, BetKey]> = [
    [`${away} spread`, 'awaySpread'], [`${home} spread`, 'homeSpread'], ['Over', 'over'], ['Under', 'under'],
    [`${away} moneyline`, 'awayMoneyline'], [`${home} moneyline`, 'homeMoneyline'],
  ];
  const cell = (book: ConsumerBookLines, key: BetKey) => {
    const value = book[key];
    if (value === null || value === undefined) return <td key={book.sportsbook} className="gl-muted">—</td>;
    const winner = books.length > 1 && best[key]?.differs && best[key]?.best.sportsbook === book.sportsbook;
    const text = typeof value === 'number' ? priceText(value)
      : `${key.endsWith('Spread') && value.point !== null ? pointText(value.point) : value.point ?? ''} ${priceText(value.price)}`;
    return <td key={book.sportsbook} className={winner ? 'gl-best-cell' : undefined}>{text}{winner && <span className="sr-only"> (better number)</span>}</td>;
  };
  return <section className="gl-card gl-table-wrap gl-book-table" aria-labelledby="books-heading">
    <h2 id="books-heading" className="gl-table-caption">Shop the line</h2>
    <table className="gl-table">
      <thead><tr><th scope="col">Bet</th>{books.map(book => <th key={book.sportsbook} scope="col">{book.sportsbook}</th>)}</tr></thead>
      <tbody>{rows.map(([label, key]) => <tr key={key}><th scope="row">{label}</th>{books.map(book => cell(book, key))}</tr>)}</tbody>
    </table>
    <p className="gl-note">Highlighted: the better number for that bet. Lines as of {new Date(books.map(book => book.capturedAt).sort().at(-1)!).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}; books move them often.</p>
  </section>;
}
