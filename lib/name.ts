/** Live input filter: drops every character a name may not contain. Kept out of validation.ts so forms can use it without bundling Zod. */
export const stripNameChars = (v: string) => v.replace(/\u2019/g, "'").replace(/[^\p{L}\p{M} .'-]/gu, '');
