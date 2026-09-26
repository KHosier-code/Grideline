import { useEffect } from 'react';
import { useLocation } from 'wouter';

const pages: Record<string, [string, string]> = {
  '/': ['Gridline | NFL Games and Model Evidence', 'Explore saved NFL matchups, available model evidence and source status. Missing projections are marked unavailable; predictions are not guaranteed results.'],
  '/games': ['NFL Games and Saved Matchups | Gridline', 'Browse NFL matchups and their saved projections, market evidence and official results where available. Data and comparisons may be incomplete.'],
  '/methodology': ['Methodology and Limitations | Gridline', 'Learn how Gridline sources NFL data, labels saved and official predictions, separates player simulations from forecasts, and grades verified results.'],
  '/performance': ['Verified Prediction Performance | Gridline', 'Review available graded official NFL predictions, eligible sample counts and model error measures. These are not betting-return claims.'],
};

const setMeta = (selector: string, attribute: string, value: string) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    const [key, name] = attribute === 'name' ? ['name', selector.match(/name="([^"]+)"/)?.[1]] : ['property', selector.match(/property="([^"]+)"/)?.[1]];
    if (name) element.setAttribute(key, name);
    document.head.appendChild(element);
  }
  element.setAttribute('content', value);
};

export function setPublicMetadata(path: string, title: string, description: string, index = true) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const canonical = `${window.location.origin}${base}${path}`;
  const image = `${window.location.origin}${base}/gridline-share.png`;
  document.title = title;
  setMeta('meta[name="description"]', 'name', description);
  setMeta('meta[name="robots"]', 'name', index ? 'index, follow' : 'noindex, nofollow');
  for (const [name, content] of Object.entries({
    'og:title': title, 'og:description': description, 'og:image': image,
    'twitter:title': title, 'twitter:description': description, 'twitter:image': image,
  })) setMeta(`meta[${name.startsWith('og:') ? 'property' : 'name'}="${name}"]`, name.startsWith('og:') ? 'property' : 'name', content);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!index) link?.remove();
  else {
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = canonical;
  }
  if (index) setMeta('meta[property="og:url"]', 'property', canonical);
  else document.head.querySelector('meta[property="og:url"]')?.remove();
}

export function useRouteMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const path = location.split('?')[0].replace(/\/$/, '') || '/';
    const page = pages[path];
    if (page) setPublicMetadata(path, page[0], page[1]);
    else setPublicMetadata(path, 'Gridline | Private or unavailable page', 'This page is not included in public search results.', false);
  }, [location]);
}