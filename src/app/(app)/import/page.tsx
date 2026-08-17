import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { GpxImportWizard } from "@/components/GpxImportWizard";

export default async function ImportPage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "import.title")}</h1>
        <p>{t(locale, "import.subtitle")}</p>
      </div>
      <GpxImportWizard locale={locale} />
    </>
  );
}
