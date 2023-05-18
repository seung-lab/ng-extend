export async function authFetch(url: string, token: string): Promise<any|undefined> {
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
    }
  });
  if (res.status === 200) {
    const contentType = res.headers.get("content-type");
    const message = await ((contentType === 'application/json') ? res.json() : res.text());
    return message;
  }
}