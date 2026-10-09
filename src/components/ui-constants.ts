/** 缘阶各阶的章色: 浅色处与照片暗底各一套, 阶越高越显贵气 */
export const TIER_STYLES: Array<{ light: string; dark: string }> = [
  { light: 'border border-border bg-secondary text-muted-foreground', dark: 'bg-card/85 text-muted-foreground' },
  { light: 'border border-primary/40 bg-primary/10 text-primary', dark: 'bg-primary text-primary-foreground' },
  { light: 'seal', dark: 'seal' },
  { light: 'bg-red-ink text-primary-foreground', dark: 'bg-red-ink/95 text-primary-foreground ring-1 ring-gold/70' },
  { light: 'bg-gradient-to-br from-gold to-gold-soft text-red-ink', dark: 'bg-gold text-red-ink' },
]
