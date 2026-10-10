/** "D.J. Moore Jr." -> "dj-moore-jr": a player's page on /td/. Must match playerSlug() in the API. */
export function playerSlug(name: string) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
