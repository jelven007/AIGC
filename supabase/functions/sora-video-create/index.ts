// 旧接口缺少任务归属及计费关联，统一改走 video-jobs。
import { retiredVideoHandler } from '../_shared/retired-video.ts';
Deno.serve(retiredVideoHandler);
