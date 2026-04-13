import { DocsSidebar } from "@/components/docs/sidebar";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  publisher: {
    "@type": "Organization",
    name: "Optio",
    url: "https://optio.host",
  },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": "https://optio.host/docs",
  },
  about: {
    "@type": "SoftwareApplication",
    name: "Optio",
    applicationCategory: "DeveloperApplication",
  },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-65px)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <DocsSidebar />
      <div className="flex-1 px-6 md:px-12 py-10 max-w-4xl">{children}</div>
    </div>
  );
}
