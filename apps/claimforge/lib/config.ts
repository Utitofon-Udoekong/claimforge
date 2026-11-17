function read(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

export const siteConfig = {
  widgetFactoryUrl: read(
    "NEXT_PUBLIC_WIDGET_FACTORY_URL",
    "https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit?usp=sharing",
  ),
  githubUrl: read("NEXT_PUBLIC_GITHUB_URL", "https://github.com/your-org/bchblaze"),
  ember2026Address: read(
    "NEXT_PUBLIC_EMBER2026_ADDRESS",
    "bitcoincash:zpln0flvp7gcx6qncy6rrrtj8eqnzman3syf09q2eq",
  ),
  fldchCategory: "0adb865ee9cc3038de87fba682e6cd361414edc9acff0da2fd0690d75341c640",
};
