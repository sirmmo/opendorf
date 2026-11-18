# Height of the top surface at each edge midpoint and corner of a KayKit hex tile, with the
# colour class there (G grass, R road/sand, W water). Shows that the sea sits at -0.20, river
# water at -0.10 and grass at 0, and which corners of coast tiles slope down to the sea.
#
#   cd <pack>/Assets/gltf && python3 /path/to/tools/heights.py

import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.argv = [sys.argv[0], '.']
from edges import load, cls, tex  # noqa: E402
def probe(path, pts):
    P,U,I=load(path); res=[]
    tris=[]
    for t in range(0,len(I),3):
        a,b,c=I[t:t+3]; pa,pb,pc=P[a],P[b],P[c]
        u=[pb[k]-pa[k] for k in range(3)]; v=[pc[k]-pa[k] for k in range(3)]
        n=(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]); L=math.sqrt(sum(x*x for x in n)) or 1
        uv=[(U[a][0]+U[b][0]+U[c][0])/3,(U[a][1]+U[b][1]+U[c][1])/3]
        if abs(n[1])/L>0.3: tris.append((pa,pb,pc,cls(tex(*uv))))
    out=[]
    for qx,qz in pts:
        best=None
        for pa,pb,pc,cl in tris:
            def s(p1,p2): return (qx-p2[0])*(p1[2]-p2[2])-(p1[0]-p2[0])*(qz-p2[2])
            d1,d2,d3=s(pa,pb),s(pb,pc),s(pc,pa)
            if (d1<0 or d2<0 or d3<0) and (d1>0 or d2>0 or d3>0): continue
            # barycentric height
            det=(pb[2]-pc[2])*(pa[0]-pc[0])+(pc[0]-pb[0])*(pa[2]-pc[2])
            if abs(det)<1e-9: continue
            l1=((pb[2]-pc[2])*(qx-pc[0])+(pc[0]-pb[0])*(qz-pc[2]))/det
            l2=((pc[2]-pa[2])*(qx-pc[0])+(pa[0]-pc[0])*(qz-pc[2]))/det
            y=l1*pa[1]+l2*pb[1]+(1-l1-l2)*pc[1]
            if best is None or y>best[0]: best=(y,cl)
        out.append('%s%.2f'%(best[1],best[0]) if best else '?')
    return out
mid=[(0.97*math.cos(math.radians(60*k)),0.97*math.sin(math.radians(60*k))) for k in range(6)]
cor=[(1.1*math.cos(math.radians(60*k+30)),1.1*math.sin(math.radians(60*k+30))) for k in range(6)]
for f in ['tiles/base/hex_water','tiles/base/hex_grass','tiles/coast/hex_coast_A','tiles/coast/hex_coast_B','tiles/coast/hex_coast_C','tiles/coast/hex_coast_D','tiles/coast/hex_coast_E','tiles/rivers/hex_river_A','tiles/rivers/hex_river_B']:
    print(f.split('/')[-1].ljust(16),'mid',' '.join(probe(f+'.gltf',mid)),'| corners',' '.join(probe(f+'.gltf',cor)))
