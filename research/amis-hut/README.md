# Small Amis thatched house (阿美族茅草屋): research notes

Research for the procedural model in `simulator/src/scene/hut/` and the spec
`designs/huts/amis-small.hut.json`. Done 2026-11-20. The cloud session could
search the web but could not open the pages themselves (the network policy
blocks the sites), so everything below comes from search-result extracts of
the pages listed under Sources. Numbers that the sources do not give are marked
**(estimate)** with the reasoning behind them.

## Which house

Chijiiwa Suketarō's 1942 survey (台灣建築會誌 14:5, "アミ族の住家") sorts Amis
houses into two plans:

- **單室平入型** (single room, door on the long side): Nanshi (南勢) and
  Xiuguluan (秀姑巒) Amis, e.g. Tafalong and Makotaay (大港口).
- **複室妻入型** (several rooms, door on the gable end): Coastal and Malan Amis.

A *small* house is the single-room type, so the model is a 單室平入型 house:
one room, no partitions, hearth in the middle, sleeping platforms round the
walls, door in the middle of a long side. The field hut (talo'an, 工寮) is
built the same way from the same plants, only smaller, so the model also
stands in for a talo'an.

## Structure (what the model follows)

| Part | Amis term | What the sources say | Model |
|---|---|---|---|
| Posts | | Wood posts, often flat plank-shaped (扁平板狀); at Fata'an (馬太鞍) bamboo, wood or betel-palm trunks; front posts longer | 8 hewn flat wall posts (180 x 90 mm), earth-fast |
| Ridge post | satoko (中脊柱) | "The most important post", carries the ridge | 1 round ridge post at each gable, forked top |
| Purlins / plates | falag (桁條) | Roof building starts from the purlins | Wall plate on each long side, 2 mid purlins, ridge pole |
| Rafters | tukisu (角木) | Laid on the purlins, local wood | Thorny-bamboo (刺竹) poles, 0.5 m apart, crossing at the ridge |
| Roof lining | raina (竹編小舞) | Arrow bamboo (fudo, 箭竹) split in half, 3-4 halves tied together with rattan ('oway, 黃藤); dries yellow; a hallmark of Amis roofs | Horizontal laths of 3 split arrow-bamboo halves, 180 mm apart, rattan at every rafter crossing |
| Thatch | fadahong (roof) | Cogon (白茅, *Imperata cylindrica*) tied in bundles, then into larger mats, laid course by course and bound with rattan skin; two directions alternating (lower layer butts out, upper layer butts toward the ridge); replenished yearly, fully renewed every 3-4 years; outer edges laid first | 13 courses per side, butts out, about 25 cm thick |
| Pressing poles | | Silvergrass (五節芒, *Miscanthus floridulus*) stems laid across the thatch at equal spacing | Bundles of 3 stems every 45 cm, stitched to the laths with rattan |
| Ridge | | Ridge thickened and covered; a decoration ('anogunon) laid on top | Thick folded-thatch ridge roll bound with rattan; the decoration is left out (no description of its shape was found) |
| Walls | | Three layers: reed / cogon / arrow bamboo; silvergrass stems (to 3-4 m, ~1.5 cm) are the main wall body; 10-12 cm thick; all joints rattan-lashed; the wall's clamping slats are of the same kind as the roof pressing poles | Outer face of vertical silvergrass stems, cogon core, inner face of arrow bamboo, clamped by split-bamboo rails stitched with rattan; 110 mm |
| Door / frames | | Thorny bamboo (刺竹) for roof cross members and door and window frames | Thorny-bamboo door frame in the middle of the front, arrow-bamboo door leaf |
| Beds | kafoti'an | Sleeping places on both sides, rattan or fine bamboo, 40-60 cm off the floor | Platform along the back wall at 45 cm, slatted with split bamboo |
| Hearth | | Central hearth in single-room houses; no chimney, smoke escapes through the thatch | Three hearth stones in an ash bed, middle of the room |
| Eaves | | Eaves run past the wall and come down lower than a person | Eave edge about 1.2 m above the ground |
| Fixings | | No iron at all; rattan at every joint (modern repairs sometimes swap in plastic string) | Rattan only |

## Dimensions (estimates)

None of the reachable sources gives metric dimensions (they sit in Chijiiwa's
measured drawings, 千千岩助太郎台灣高砂族住家調查測繪手稿全集, 2012). The model uses:

- Walls 4.2 m x 3.0 m (three 1.4 m bays). Small for a family house (the ideal
  big house sleeps about 20), large for a field hut. **(estimate)**
- Wall height 1.6 m to the plate. Eave edge ~1.2 m, consistent with "lower than
  a person". **(estimate)**
- Ridge ~3.3 m: a roof pitch of about 45°, steep enough for cogon thatch to
  shed rain (thatch generally wants 40-50°). **(estimate)**
- Eave overhang 0.55 m, gable overhang 0.4 m. **(estimate)**
- Thatch 25 cm thick (typical for cogon; the 10-12 cm figure is for walls). **(estimate)**

## Sources

Museums, encyclopaedias and archives
- 臺灣原住民族事典, 阿美族傳統住屋: https://indigenapedia-alcd.nccu.edu.tw/detail?id=10058&search=&cat=30&race=0&writer=  (plan types, satoko)
- 臺灣原住民族事典, 阿美族祖靈屋: https://aborgpedia.alcd.center/detail?cat=0&id=10075&race=0&search=%E9%98%BF%E7%BE%8E%E6%97%8F&writer=
- 臺灣原住民族事典, 五節芒: https://aborgpedia.alcd.center/detail?id=9484
- 台灣原住民族文化園區, 阿美族傳統家屋: https://www.tacp.gov.tw/cultural-park/introduction/14
- 國家文化記憶庫, 阿美族港口社家屋: https://tcmb.culture.tw/zh-tw/detail?indexCode=Culture_Object&id=283437
- 國家文化記憶庫, 茅草屋: https://tcmb.culture.tw/zh-tw/detail?indexCode=Culture_Place&id=284652
- 數位典藏, 豐南部落傳統茅草屋: https://catalog.digitalarchives.tw/item/00/43/49/b3.html
- 數位典藏, 港口部落: https://catalog.digitalarchives.tw/item/00/43/49/9b.html
- OpenMuseum, 阿美族住屋型態: https://openmuseum.tw/muse/exhibition/dfb841eca97c0588f6b5c4af964d38f9
- 臺灣老照片, 阿美族家屋: https://tme.ncl.edu.tw/
- 阿美族民俗中心 (Amis Folk Center): https://www.eastcoast-nsa.gov.tw/zh-tw/attractions/detail/42/
- 臺灣原住民族文化知識網, 建築工藝-阿美族: https://knowlegde.gov.taipei/News_Content.aspx?n=E2774B2FD4A88AD0&sms=D8939B9274D1E899&s=31227A9670C73BED
- 阿美語萌典, talo'an: https://new-amis.moedict.tw/terms/talo'an

Research
- 千千岩助太郎 (Chijiiwa Suketarō), アミ族の住家, 台灣建築會誌 14(5), 1942; 台灣高砂族の住家, 丸善 1960; 測繪手稿全集 2012: https://tiprc.cip.gov.tw/blog_wp/?p=3949
- 日治後期阿美族的「改良蕃屋」: 千千岩助太郎調查與原住民家屋變遷 (政大): https://ah.nccu.edu.tw/item?item_id=89110
- 千々岩助太郎 site: https://chijiiwa.kaishao.idv.tw/
- Traditional Amis Architecture and Its Environment (eScholarship): https://escholarship.org/content/qt16m186zr/qt16m186zr_noSplash_dbcac75575d20f12cf8ef6d7593ab871.pdf
- The Amis and prehistory in cultural heritage development in Taiwan (BIPPA): https://journals.lib.washington.edu/index.php/BIPPA/article/download/11992/10617  (eaves lower than a person, rectangular plan facing a yard, after Chijiiwa 1960)
- Yeh Shu-Ling, Migration and homemaking practices among the Amis (ANU): https://press-files.anu.edu.au/downloads/press/n4043/pdf/ch09.pdf
- 民族植物中的文化關鍵物種知識結構, 吉拉米代部落: https://www.researchgate.net/publication/369776426
- 周穎君, 阿美族傳統家屋研究, 東海大學建築研究所碩士論文, 2002 (cited, not read)

Articles, blogs, news and community builds
- Mata Taiwan, 阿美族傳統家屋的女性神秘空間: https://www.matataiwan.com/2019/06/06/amis-house/
- Mata Taiwan, 阿美族的傳統植物建材運用 (raina, cogon, silvergrass, rattan): https://www.matataiwan.com/2019/06/18/amis-plant/
- 圖解台灣建築史, 來去部落住一晚 (卷二): https://vocus.cc/article/5a1219d8eceaed97b4026646
- 恆春工商原住民文化傳承網, 阿美族建築: https://sites.google.com/a/hcvs.ptc.edu.tw/hcvsymweb102/a-mei-zu-jian-zhu
- 數位走讀, 阿美族傳統建築: https://dguidedwalks.tw/ (Tamaluwan, Traditional Amis Architecture)
- 原視 TITV, 港口 Cepo' 藝術中心邀長者青年建茅草家屋 (2021): http://titv.ipcf.org.tw/news-66608
- 原視 TITV, 靜浦部落居民修繕草屋: https://news.ipcf.org.tw/17166
- 原視 TITV, 瑟冷部落建造傳統 Taluan (2024): https://news.ipcf.org.tw/124062
- 後山小調, 玉里重現阿美族茅草屋 (觀音國小; 桂竹, 黃藤, 刺竹, 茅草, 杉木): https://www.thehubnews.net/archives/74946
- 東海岸部落工作假期 2026, 茅草屋頂修繕 (ridge thickened): https://www.jacreative.com.tw/eastcwh/2026/cIwkangan.html
- 公視 我們的島, 蓋自己的家屋: https://ourisland.pts.org.tw/content/7212
- 農業知識入口網, 阿美族的藤編與生活: https://kmweb.moa.gov.tw/theme_data.php?theme=news&sub_theme=agri_life&id=59415
- Elegant Experiments, How to build a bamboo house in the Amis style (bamboo roof carpentry, vine joints, smoke through the roof, floor ~40 cm in a museum replica): https://www.elegantexperiments.net/en/post/amis-bamboo-house-taiwan/
- Taiwan Panorama, People Who Live in Grass Houses: https://www.taiwan-panorama.com/en/Articles/Details?Guid=8b9c27a4-28e6-4a64-8eaf-6b18cd61853c
- Malacecay, Amis culture house rebuild at Chenggong: https://en.enjoy-nature-house.com/post/malacecay-let-s-work-together-to-pass-on-amis-culture

Social media: searches for YouTube, Facebook and Instagram build posts found
nothing that the search tool could surface; the TITV and PTS reports above are
the video builds that could be found.

## Open questions

- Exact proportions from Chijiiwa's drawings (bay width, post height, pitch).
- Shape of the ridge decoration ('anogunon).
- Whether the posts of a small house sit inside or outside the wall layers
  (the model puts the walls on the outside of the posts).
