export function addressViewer(text: string, name: string): string {
  const cleaned = text.replace(/\s+/gu, ' ').trim();
  const addressed = cleaned.replace(/(^|[^\p{L}])bạn(?=$|[^\p{L}])/giu, (_match, prefix: string) => `${prefix}${name}`);
  return addressed.toLocaleLowerCase('vi').includes(name.toLocaleLowerCase('vi')) ? addressed : `${name} ơi, ${addressed}`;
}
