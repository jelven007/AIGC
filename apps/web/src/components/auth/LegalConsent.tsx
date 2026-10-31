import { Checkbox } from '@/components/ui/checkbox';

function documentUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export const termsUrl = documentUrl(import.meta.env.VITE_TERMS_URL);
export const privacyUrl = documentUrl(import.meta.env.VITE_PRIVACY_URL);
export const legalDocumentsReady = !!termsUrl && !!privacyUrl;

/** 正式法务资源由经营方提供；不把占位正文当成已发布协议。 */
export function LegalConsent({ agreed, onChange, disabled = false }: {
  agreed: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  return <div className="space-y-2">
    <div className="flex items-start gap-2.5">
      <Checkbox id="agreed" checked={agreed} disabled={disabled || !legalDocumentsReady}
        onCheckedChange={value => onChange(value === true)} className="mt-0.5" aria-describedby={!legalDocumentsReady ? 'legal-unavailable' : undefined} />
      <div className="text-xs text-muted-foreground leading-relaxed">
        <label htmlFor="agreed">我已阅读并同意</label>
        {termsUrl ? <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline mx-0.5">《用户协议》</a> : <span>《用户协议》</span>}
        和
        {privacyUrl ? <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline mx-0.5">《隐私政策》</a> : <span>《隐私政策》</span>}
      </div>
    </div>
    {!legalDocumentsReady && <p id="legal-unavailable" role="status" className="text-xs text-muted-foreground">
      注册协议暂未发布，暂时无法创建账号。已有账号可直接登录。
    </p>}
  </div>;
}
