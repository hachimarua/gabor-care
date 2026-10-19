# 絵の点（1日1点・100点で1枚）を作る。
#   python3 scripts/generate-drawings.py data/drawings.json
# 輪郭は基本図形（楕円・多角形）の和で書く。輪郭の内側を2px格子で取り、
# 輪郭沿い55点＋内側45点を最遠点サンプリングで均等に選ぶ。並び順は種つきの乱数で、
# 何日目にどこへ点が入るかを決める（途中で形が少しずつ見えてくる）。
# 題材の名前は完成まで本人に見せない約束なので、名前は base64 で持つ。
import math, random, json, sys

def ell(cx,cy,rx,ry,rot=0):
    c,s=math.cos(math.radians(rot)),math.sin(math.radians(rot))
    def f(x,y):
        dx,dy=x-cx,y-cy; u=dx*c+dy*s; v=-dx*s+dy*c
        return (u/rx)**2+(v/ry)**2<=1
    return f
def poly(pts):
    def f(x,y):
        ins=False; n=len(pts)
        for i in range(n):
            x1,y1=pts[i]; x2,y2=pts[(i+1)%n]
            if (y1>y)!=(y2>y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1: ins=not ins
        return ins
    return f
def rect(x,y,w,h): return poly([(x,y),(x+w,y),(x+w,y+h),(x,y+h)])
def union(*fs): return lambda x,y: any(f(x,y) for f in fs)
def minus(a,b): return lambda x,y: a(x,y) and not b(x,y)

SHAPES={
 # 見本（本番の5つには含めない）
 "sample": union(lambda x,y: math.dist((x,y),(80,80))<=190 and math.dist((x,y),(250,250))<=190 and not (x+y<150) and not (x+y>390),
                 poly([(236,240),(246,232),(292,286),(284,294)])),
 "s1": union(ell(150,215,78,62), ell(212,150,40,36), ell(196,72,13,52,-12), ell(230,76,13,50,14),
             ell(76,222,15,15), ell(118,268,34,14), ell(205,268,26,12)),
 "s2": union(ell(150,175,118,52,-4), poly([(246,158),(300,92),(316,104),(280,172),(316,240),(300,252),(246,186)]),
             poly([(130,214),(160,214),(122,250)]), ell(70,175,30,40)),
 "s3": union(ell(118,196,62,36,-8), poly([(150,182),(226,48),(246,56),(178,196)]), ell(250,52,26,14,-18),
             rect(232,22,4,18), rect(246,20,4,18), rect(68,218,10,80), rect(92,222,10,76), rect(140,220,10,78), rect(162,214,10,84),
             poly([(58,186),(30,226),(38,230),(64,196)])),
 "s4": union(ell(150,222,70,72), ell(168,124,52,46), poly([(126,100),(124,46),(158,86)]), poly([(178,86),(212,46),(214,100)]),
             minus(ell(78,250,58,42), ell(92,242,40,26)), ell(112,284,22,12), ell(186,286,24,12)),
 "s5": union(lambda x,y: math.dist((x,y),(160,200))<=110 and y<=200,
             ell(272,186,28,20,-10), ell(92,222,18,22), ell(212,222,18,22), ell(118,222,16,20), ell(190,222,16,20),
             poly([(50,190),(30,206),(54,200)]), rect(52,192,216,14)),
}
def sample_points(f, seed, n_edge=55, n_in=45, step=2):
    inside=[(x,y) for x in range(0,321,step) for y in range(0,321,step) if f(x,y)]
    S=set(inside)
    edge=[p for p in inside if any((p[0]+dx,p[1]+dy) not in S for dx,dy in ((step,0),(-step,0),(0,step),(0,-step)))]
    def fps(cands,k,start=None,keep=()):
        chosen=list(keep); out=[]
        dist={p:min([math.dist(p,q) for q in chosen] or [1e9]) for p in cands}
        cur=start or cands[0]
        for _ in range(k):
            if out or chosen:
                cur=max(cands,key=lambda p:dist[p])
            out.append(cur); chosen.append(cur)
            for p in cands:
                d=math.dist(p,cur)
                if d<dist[p]: dist[p]=d
        return out
    e=fps(edge,n_edge)
    deep=[p for p in inside if min(math.dist(p,q) for q in edge[::3])>9]
    i=fps(deep,n_in,keep=e)
    pts=e+i
    random.Random(seed).shuffle(pts)
    return pts


NAMES_B64={'sample': '6JGJ', 's1': '44Km44K144Ku', 's2': '44Kv44K444Op', 's3': '44Kt44Oq44Oz', 's4': '44ON44Kz', 's5': '44Kr44Oh'}

def centered(pts):
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    dx=160-(min(xs)+max(xs))/2; dy=160-(min(ys)+max(ys))/2
    return [[round(x+dx,1),round(y+dy,1)] for x,y in pts]

data={"version":1,"dotsPerDrawing":100,"viewBox":320,
      "sample":{"id":"sample","name_b64":NAMES_B64["sample"],"points":centered(sample_points(SHAPES["sample"],seed=sum(map(ord,"sample"))))},
      "drawings":[{"id":k,"name_b64":NAMES_B64[k],"points":centered(sample_points(SHAPES[k],seed=sum(map(ord,k))))} for k in ("s1","s2","s3","s4","s5")]}
json.dump(data,open(sys.argv[1],"w",encoding="utf-8"),ensure_ascii=False,separators=(",",":"))
print("drawings",len(data["drawings"]),"points",[len(d["points"]) for d in data["drawings"]])
