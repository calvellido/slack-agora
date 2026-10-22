/** An address as people read it, such as `github.com/calvellido/slack-agora`: without `https://` or a final slash. */
export function readableUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
