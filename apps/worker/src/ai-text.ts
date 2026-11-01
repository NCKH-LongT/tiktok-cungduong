export function addressViewer(text: string, name: string): string {
  const cleaned = text.replace(/\s+/gu, ' ').trim();
  const addressed = cleaned.replace(/(^|[^\p{L}])bạn(?=$|[^\p{L}])/giu, (_match, prefix: string) => `${prefix}${name}`);
  return addressed.toLocaleLowerCase('vi').includes(name.toLocaleLowerCase('vi')) ? addressed : `${name} ơi, ${addressed}`;
}

export function limitReplyWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/u);
  if (words.length <= maxWords) return text.trim();
  const prefix = words.slice(0, maxWords).join(' ');
  const sentenceEnds = [...prefix.matchAll(/[.!?…](?=\s|$)/gu)];
  const lastSentence = sentenceEnds.at(-1);
  if (lastSentence && prefix.slice(0, lastSentence.index! + 1).split(/\s+/u).length >= maxWords * 0.6) {
    return prefix.slice(0, lastSentence.index! + 1);
  }
  return `${prefix.replace(/[,;:.!?…]+$/u, '')}…`;
}
