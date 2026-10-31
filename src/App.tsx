import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

function RedirectWithState({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={to} state={location.state} replace />;
}
function LoginRedirect() {
  const location = useLocation();
  if (new URLSearchParams(location.search).get('mode') === 'reset') return <Navigate to="/auth/reset" replace />;
  const to = new URLSearchParams(location.search).get('redirect') === '/credits?tab=plans' ? '/credits?tab=plans' : '/';
  return <Navigate to={to} replace />;
}
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { lazy, Suspense, Component, useState, useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// FP-01: 路由级懒加载
const LoginPage       = lazy(() => import("@/pages/auth/LoginPage"));
const ResetPasswordPage = lazy(() => import("@/pages/auth/ResetPasswordPage"));
const MainLayout = lazy(() => import("@/components/layouts/MainLayout"));
const LandingPage     = lazy(() => import("@/pages/marketing/LandingPage"));
const HomePage        = lazy(() => import("@/pages/workspace/HomePage"));
const WorksPage       = lazy(() => import("@/pages/production/WorksPage"));
const AnalyticsPage   = lazy(() => import("@/pages/analytics/AnalyticsPage"));
const ProfilePage     = lazy(() => import("@/pages/account/ProfilePage"));
const ModelSettingsPage = lazy(() => import("@/pages/settings/ModelSettingsPage"));
const IntegrationSettingsPage = lazy(() => import("@/pages/settings/IntegrationSettingsPage"));
const OperationsPage = lazy(() => import("@/pages/operations/OperationsPage"));
const SupportPage = lazy(() => import("@/pages/operations/SupportPage"));
const ProductsPage    = lazy(() => import("@/pages/catalog/ProductsPage"));
const ProductSelectionPage = lazy(() => import("@/pages/catalog/ProductSelectionPage"));
const AvatarsPage     = lazy(() => import("@/pages/production/AvatarsPage"));
const TemplatesPage   = lazy(() => import("@/pages/production/TemplatesPage"));
const CreditsPage     = lazy(() => import("@/pages/billing/CreditsPage"));
const AlipayReturnPage  = lazy(() => import("@/pages/billing/AlipayReturnPage"));
const ScriptPage      = lazy(() => import("@/pages/production/ScriptPage"));
const StyleCopyPage   = lazy(() => import("@/pages/production/StyleCopyPage"));
const KnowledgePage   = lazy(() => import("@/pages/knowledge/KnowledgePage"));
const CompetitorPage  = lazy(() => import("@/pages/intelligence/CompetitorPage"));
const LiveHighlightPage      = lazy(() => import("@/pages/production/LiveHighlightPage"));
const PromptTemplatesPage    = lazy(() => import("@/pages/production/PromptTemplatesPage"));
const OrderDetailPage        = lazy(() => import("@/pages/billing/OrderDetailPage"));
const VideoEditPage          = lazy(() => import("@/pages/production/VideoEditPage"));
const ActivitiesPage         = lazy(() => import("@/pages/account/ActivitiesPage"));
const InvitePage             = lazy(() => import("@/pages/account/InvitePage"));
// Phase 2 新增页面
const ABTestPage             = lazy(() => import("@/pages/analytics/ABTestPage"));
const EmotionAnalysisPage    = lazy(() => import("@/pages/production/EmotionAnalysisPage"));
const MultiLangPage          = lazy(() => import("@/pages/production/MultiLangPage"));
const TaskQueuePage          = lazy(() => import("@/pages/production/TaskQueuePage"));
const ExportFormatsPage      = lazy(() => import("@/pages/production/ExportFormatsPage"));
const LLMCachePage           = lazy(() => import("@/pages/knowledge/LLMCachePage"));
// Phase 3 新增页面
const TeamSpacePage          = lazy(() => import("@/pages/account/TeamSpacePage"));
const OpenAPIPage            = lazy(() => import("@/pages/settings/OpenAPIPage"));
const DataFeedbackPage       = lazy(() => import("@/pages/analytics/DataFeedbackPage"));
const TrendingPatternsPage   = lazy(() => import("@/pages/intelligence/TrendingPatternsPage"));
const PersonalizePage        = lazy(() => import("@/pages/workspace/PersonalizePage"));
const BatchCreatePage        = lazy(() => import("@/pages/production/BatchCreatePage"));
const AiToolboxPage          = lazy(() => import("@/pages/workspace/AiToolboxPage"));
const NotificationsPage      = lazy(() => import("@/pages/workspace/NotificationsPage"));
const MaterialsPage          = lazy(() => import("@/pages/production/MaterialsPage"));
const PublishPage            = lazy(() => import("@/pages/production/PublishPage"));
const DataDashboardPage      = lazy(() => import("@/pages/analytics/DataDashboardPage"));

import { supabase } from "@/db/supabase";
import { accountRequest } from "@/api/accountSession";
import { CreditsSync } from "@/hooks/useCredits";
import PlanGate from "@/components/PlanGate";
import ForbiddenPage from "@/components/ForbiddenPage";
import { Send, CheckCircle2 } from "lucide-react";

// F-13: 页面级加载占位
function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">页面加载中...</p>
      </div>
    </div>
  );
}

// F-13: 增强型 React Error Boundary (支持重试、一键上报 error_logs)
interface EBState {
  hasError: boolean;
  error?: Error;
  reported: boolean;
  reporting: boolean;
  reportError: string;
}

class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, EBState> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, reported: false, reporting: false, reportError: '' };
  }
  private reportKey = crypto.randomUUID();
  private reportGeneration = 0;
  private active = true;
  componentDidMount() { this.active = true; }
  componentWillUnmount() { this.active = false; this.reportGeneration++; }

  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReportError = async () => {
    if (this.state.reported || this.state.reporting) return;
    const generation = this.reportGeneration;
    this.setState({ reporting: true, reportError: '' });
    try {
      const { data: sessionData, error } = await supabase.auth.getSession();
      const currentUserId = sessionData?.session?.user?.id ?? null;
      if (!this.active || generation !== this.reportGeneration) return;
      if (error || !currentUserId) throw new Error('会话已失效');
      const result = await accountRequest(currentUserId, '/rest/v1/rpc/report_frontend_error', 'POST', {
        p_request_key: this.reportKey,
        p_path: window.location.pathname,
      });
      if (!this.active || generation !== this.reportGeneration) return;
      if (!result?.ok || result.request_key !== this.reportKey || !result.id) throw new Error('上报回执无效');
      this.setState({ reported: true, reporting: false });
    } catch (e) {
      console.warn('[ErrorBoundary] 错误日志上报失败:', e);
      if (this.active && generation === this.reportGeneration) this.setState({
        reported: false, reporting: false, reportError: '异常记录尚未确认，请重试上报。',
      });
    }
  };

  handleReset = () => {
    this.reportGeneration++; this.reportKey = crypto.randomUUID();
    this.setState({ hasError: false, error: undefined, reported: false, reporting: false, reportError: '' });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>
          <div className="space-y-1.5 max-w-md">
            <p className="font-semibold text-lg text-foreground">页面运行遇到了问题</p>
            <p className="text-sm text-muted-foreground text-pretty">
              {this.state.error?.message ?? '发生了意外错误，已为您保护会话安全。'}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button variant="default" size="sm" onClick={this.handleReset} className="gap-1.5">
              <RefreshCw className="w-4 h-4" /> 尝试恢复
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="gap-1.5">
              刷新整个页面
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={this.state.reported || this.state.reporting}
              onClick={this.handleReportError}
              className="gap-1.5 text-xs"
            >
              {this.state.reported ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> 异常记录已提交
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> {this.state.reporting ? '正在上报...' : '一键上报异常'}
                </>
              )}
            </Button>
          </div>
          {this.state.reportError && <p role="alert" className="text-sm text-destructive">{this.state.reportError}</p>}

          {this.state.error?.stack && (
            <details className="mt-4 text-left max-w-xl text-xs text-muted-foreground/80 bg-muted/30 p-3 rounded-lg border border-border/50 overflow-auto max-h-40">
              <summary className="cursor-pointer font-mono mb-1 text-[11px] text-muted-foreground hover:text-foreground">
                查看技术诊断信息
              </summary>
              <pre className="whitespace-pre-wrap font-mono text-[10px] leading-tight">
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient();

function AccountScope({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  useEffect(() => () => { void client.cancelQueries(); client.clear(); }, [client]);
  return <QueryClientProvider client={client}><CreditsSync />{children}</QueryClientProvider>;
}

function AppRoutes() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const previousAccount = useRef<string | null>(null);
  const inheritedStateKey = useRef<string | null>(null);
  if (session) {
    if (previousAccount.current && previousAccount.current !== session.user.id) inheritedStateKey.current = location.key;
    previousAccount.current = session.user.id;
  }
  const accountLocation = location.key === inheritedStateKey.current ? { ...location, state: null } : location;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/reset" element={<ResetPasswordPage key="anonymous" />} />
          <Route path="*" element={<Navigate to="/landing" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/auth/reset" element={<ResetPasswordPage key={session.user.id} />} />
        <Route path="/*" element={
          <AccountScope key={session.user.id}>
          <MainLayout>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes location={accountLocation}>
                  <Route path="/home" element={<RedirectWithState to="/video/create" />} />
                  <Route path="/" element={<RedirectWithState to="/video/create" />} />
                  <Route path="/video/create" element={<HomePage />} />
                  <Route path="/video/create/:projectId" element={<HomePage />} />
                  <Route path="/works" element={<WorksPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings/models" element={<ModelSettingsPage />} />
                  <Route path="/settings/integrations" element={<IntegrationSettingsPage />} />
                  <Route path="/operations" element={<OperationsPage />} />
                  <Route path="/support" element={<SupportPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/product-selection" element={<ProductSelectionPage />} />
                  <Route path="/avatars" element={<AvatarsPage />} />
                  <Route path="/templates" element={<TemplatesPage />} />
                  <Route path="/credits" element={<CreditsPage />} />
                  <Route path="/alipay-return" element={<AlipayReturnPage />} />
                  <Route path="/script" element={<ScriptPage />} />
                  <Route path="/style-copy" element={<StyleCopyPage />} />
                  <Route path="/knowledge" element={<KnowledgePage />} />
                  <Route path="/competitor" element={<CompetitorPage />} />
                  <Route path="/live-highlight" element={<LiveHighlightPage />} />
                  <Route path="/prompt-templates" element={<PromptTemplatesPage />} />
                  <Route path="/order/:orderId" element={<OrderDetailPage />} />
                  <Route path="/video/edit" element={<VideoEditPage />} />
                  <Route path="/activities" element={<ActivitiesPage />} />
                  <Route path="/invite" element={<InvitePage />} />
                  <Route path="/ab-test" element={<ABTestPage />} />
                  <Route path="/emotion-analysis" element={<EmotionAnalysisPage />} />
                  <Route path="/multilang" element={<MultiLangPage />} />
                  <Route path="/task-queue" element={<TaskQueuePage />} />
                  <Route path="/export-formats" element={<ExportFormatsPage />} />
                  <Route path="/llm-cache" element={<LLMCachePage />} />
                  {/* 权限门禁与高级功能 */}
                  <Route path="/team"              element={<TeamSpacePage />} />
                  <Route path="/open-api"          element={<OpenAPIPage />} />
                  <Route path="/data-feedback"     element={<DataFeedbackPage />} />
                  <Route path="/trending-patterns" element={<TrendingPatternsPage />} />
                  <Route path="/personalize"       element={<PersonalizePage />} />
                  <Route path="/batch-create"      element={<PlanGate requiredPlan="pro" featureName="批量混剪与脚本矩阵"><BatchCreatePage /></PlanGate>} />
                  <Route path="/ai-toolbox"         element={<AiToolboxPage />} />
                  <Route path="/notifications"      element={<NotificationsPage />} />
                  <Route path="/materials"          element={<MaterialsPage />} />
                  <Route path="/publish"            element={<PublishPage />} />
                  <Route path="/data-dashboard"     element={<DataDashboardPage />} />
                  <Route path="/403"               element={<ForbiddenPage />} />
                  <Route path="/login" element={<LoginRedirect />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </MainLayout>
          </AccountScope>
        } />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner richColors position="top-center" />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
