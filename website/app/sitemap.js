const siteUrl = "https://amaprice.sh";

export const dynamic = "force-static";

const staticEntries = [
  {
    url: "/",
    changeFrequency: "daily",
    priority: 1
  },
  {
    url: "/llms.txt",
    changeFrequency: "weekly",
    priority: 0.7
  },
  {
    url: "/llms-full.txt",
    changeFrequency: "weekly",
    priority: 0.7
  }
];

export default function sitemap() {
  const lastModified = new Date();
  return staticEntries.map((entry) => ({
    ...entry,
    url: `${siteUrl}${entry.url}`,
    lastModified
  }));
}
