"""白名单画面效果；表达式仅由数值与固定公式构建。"""
TRANSITIONS = ("none", *(f"t{index}" for index in range(1, 13)))
BLENDS = ("normal", "multiply", "screen", "overlay", "softlight", "difference", "hue", "saturation")


def transition_filters(preset, seconds):
    progress = f"min(1,max(0,T/{seconds}))"
    masks = {
        "t2": progress, "t9": progress,
        "t6": f"lte(hypot(X/W-.5,Y/H-.5),({progress})*.708)",
        "t7": f"lt(mod(abs(sin(floor(X/24)*12.9898+floor(Y/24)*78.233)*43758.5453),1),{progress})",
        "t8": f"lte(abs(X/W-.5),({progress})/2)",
        "t10": f"if(lt(T,{seconds}),({progress})*gte(mod(T*12,1),.35),1)",
        "t11": f"if(gte(T,{seconds}),1,lt(X/W,({progress})+.06*sin(Y/H*12*PI+({progress})*8*PI)))",
        "t12": f"lte((atan2(Y-H/2,X-W/2)+PI)/(2*PI),{progress})",
    }
    if preset == "t5":
        return ["geq=" + ":".join(f"{c}='255+( {c}(X,Y)-255)*({progress})'" for c in "rgb")
                + ":a='alpha(X,Y)'"]
    if preset in masks:
        return [f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({masks[preset]})'"]
    return []


def hsl_expression(mode, channel):
    """W3C 非分离混合：SetLum(SetSat(C, s), l)，再 ClipColor。

    hstack 的左半为背景，右半为前景；每个通道使用独立表达式寄存器。
    在 RGB 中计算，不能用 YUV 的色度替换冒充 CSS hue/saturation。
    """
    source = ("r(X+W/2,Y)", "g(X+W/2,Y)", "b(X+W/2,Y)") if mode == "hue" else ("r(X,Y)", "g(X,Y)", "b(X,Y)")
    saturation_source = ("r(X,Y)", "g(X,Y)", "b(X,Y)") if mode == "hue" else ("r(X+W/2,Y)", "g(X+W/2,Y)", "b(X+W/2,Y)")
    seq = [f"st({i},{value}/255)" for i, value in enumerate(source)]
    seq += [f"st({i+3},{value}/255)" for i, value in enumerate(saturation_source)]
    seq += [
        "st(6,max(ld(3),max(ld(4),ld(5)))-min(ld(3),min(ld(4),ld(5))))",
        "st(7,min(ld(0),min(ld(1),ld(2))))", "st(8,max(ld(0),max(ld(1),ld(2))))",
    ]
    seq += [f"st({i},if(gt(ld(8),ld(7)),(ld({i})-ld(7))*ld(6)/max(.000001,ld(8)-ld(7)),0))" for i in range(3)]
    seq += [
        "st(9,(.3*r(X,Y)+.59*g(X,Y)+.11*b(X,Y))/255)",
        "st(6,ld(9)-(.3*ld(0)+.59*ld(1)+.11*ld(2)))",
    ]
    seq += [f"st({i},ld({i})+ld(6))" for i in range(3)]
    seq += ["st(7,min(ld(0),min(ld(1),ld(2))))"]
    seq += [f"st({i},if(lt(ld(7),0),ld(9)+(ld({i})-ld(9))*ld(9)/max(.000001,ld(9)-ld(7)),ld({i})))" for i in range(3)]
    seq += ["st(8,max(ld(0),max(ld(1),ld(2))))",
            f"255*clip(if(gt(ld(8),1),ld(9)+(ld({channel})-ld(9))*(1-ld(9))/max(.000001,ld(8)-ld(9)),ld({channel})),0,1)"]
    return ";".join(seq)


def composite(filters, current, track, target, width, height, fps, duration, x, y, enabled, mode):
    position = f"overlay=x='{x}':y='{y}':enable='{enabled}':eof_action=pass:shortest=0:format=auto"
    if mode == "normal":
        filters.append(f"[{current}][{track}]{position}[{target}]")
        return
    # 先定位前景，再以其原始 alpha 蒙版混合；区域外和透明像素保持背景。
    filters.append(f"color=c=black@0:s={width}x{height}:r={fps}:d={duration},format=rgba[clear{target}]")
    filters.append(f"[clear{target}][{track}]{position},format=rgba,split[fg{target}][alpha{target}]")
    filters.append(f"[alpha{target}]alphaextract[mask{target}]")
    filters.append(f"[{current}]format=gbrp,split[base{target}][keep{target}]")
    filters.append(f"[fg{target}]format=gbrp[rgb{target}]")
    if mode in ("hue", "saturation"):
        formulas = ":".join(f"{c}='{hsl_expression(mode, i)}'" for i, c in enumerate("rgb"))
        filters.append(f"[base{target}][rgb{target}]hstack,geq={formulas},crop=iw/2:ih:0:0[mix{target}]")
    else:
        filters.append(f"[base{target}][rgb{target}]blend=all_mode={mode}[mix{target}]")
    filters.append(f"[keep{target}][mix{target}][mask{target}]maskedmerge,format=rgba[{target}]")
