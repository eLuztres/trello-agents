const MAX_SLUG_LENGTH = 40;

export function toBranchName(idShort: number, cardName: string): string {
  const slug = cardName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug ? `card/${idShort}-${slug}` : `card/${idShort}`;
}

export function pickRepo(labelNames: string[], repoNames: string[], defaultRepo: string): string {
  const labels = labelNames.map((name) => name.toLowerCase());
  return repoNames.find((repo) => labels.includes(repo.toLowerCase())) ?? defaultRepo;
}
