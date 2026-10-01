
-- 用户角色枚举
CREATE TYPE public.user_role AS ENUM ('user', 'admin');

-- 用户档案表
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  username text UNIQUE,
  avatar_url text,
  role public.user_role NOT NULL DEFAULT 'user',
  notification_enabled boolean NOT NULL DEFAULT true,
  theme text NOT NULL DEFAULT 'light',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 商品信息表
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL,
  selling_points text[] NOT NULL DEFAULT '{}',
  ai_selling_points text[] NOT NULL DEFAULT '{}',
  target_language text NOT NULL DEFAULT 'en',
  target_platform text NOT NULL DEFAULT 'douyin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 视频项目表（存储每次视频生成的完整配置）
CREATE TABLE public.video_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '未命名项目',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','completed','failed')),
  -- Prompt配置
  video_style text,
  duration integer DEFAULT 30,
  bgm text,
  subtitle_style text,
  prompt_text text,
  -- 分镜配置(JSON)
  storyboard jsonb DEFAULT '[]',
  -- 素材(JSON数组)
  materials jsonb DEFAULT '[]',
  -- 视频结果
  video_url text,
  thumbnail_url text,
  resolution text DEFAULT '720p',
  progress integer DEFAULT 0,
  error_message text,
  -- 流量分析
  predicted_completion_rate numeric(5,2),
  predicted_click_rate numeric(5,2),
  traffic_suggestions jsonb DEFAULT '[]',
  -- 爆款复刻
  reference_video_url text,
  style_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 素材库表
CREATE TABLE public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('image','video')),
  url text NOT NULL,
  size bigint,
  width integer,
  height integer,
  duration_sec numeric(8,2),
  tags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 知识库表（知识回写）
CREATE TABLE public.knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('storyboard','prompt','optimization')),
  content jsonb NOT NULL,
  source_project_id uuid REFERENCES public.video_projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 自动同步新用户到profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, role)
  VALUES (
    NEW.id,
    NEW.email,
    SPLIT_PART(NEW.email, '@', 1),
    'user'::public.user_role
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at自动更新函数
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_video_projects_updated_at BEFORE UPDATE ON public.video_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 获取用户角色辅助函数
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS public.user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = uid;
$$;

-- 启用RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

-- profiles策略
CREATE POLICY "admin_full_access_profiles" ON public.profiles
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "users_view_own_profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users_update_own_profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (role IS NOT DISTINCT FROM get_user_role(auth.uid()));

-- products策略
CREATE POLICY "users_manage_own_products" ON public.products
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- video_projects策略
CREATE POLICY "users_manage_own_projects" ON public.video_projects
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- materials策略
CREATE POLICY "users_manage_own_materials" ON public.materials
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- knowledge_base策略
CREATE POLICY "users_manage_own_knowledge" ON public.knowledge_base
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- 公开视图
CREATE VIEW public.public_profiles AS
  SELECT id, username, role FROM public.profiles;

-- 存储桶
INSERT INTO storage.buckets (id, name, public) VALUES 
  ('materials', 'materials', true),
  ('videos', 'videos', true),
  ('thumbnails', 'thumbnails', true);

-- 存储策略
CREATE POLICY "auth_upload_materials" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('materials', 'videos', 'thumbnails'));
CREATE POLICY "public_read_all" ON storage.objects FOR SELECT TO public
  USING (bucket_id IN ('materials', 'videos', 'thumbnails'));
CREATE POLICY "auth_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (auth.uid()::text = (storage.foldername(name))[1]);
