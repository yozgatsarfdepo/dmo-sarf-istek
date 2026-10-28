// /s/<token>  →  service.html içeriği (URL değişmez)
//
// Cloudflare Pages, ".html" hedefli 200 yeniden yazımlarını 308 yönlendirmeye çevirip
// sorgu dizesini düşürüyor. Bu yüzden token'ı sorguya taşımak yerine adres yolunda
// bırakıyoruz: service.js zaten /s/<token> yolundan kodu okuyor (tokenFromLocation).
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const assetUrl = new URL('/service.html', url.origin);
  return context.env.ASSETS.fetch(new Request(assetUrl.toString(), context.request));
}

export async function onRequestHead(context) {
  return onRequestGet(context);
}
