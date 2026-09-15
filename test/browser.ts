// Stand-in for the person's browser: GET the authorization URL and follow its redirect
// to the bridge's loopback callback. Used through GENIE_BROWSER_COMMAND in the tests.
const url = process.argv[2];
if (url === undefined) {
  process.stderr.write("browser: no url\n");
  process.exit(2);
}
const response = await fetch(url, { redirect: "follow" });
if (!response.ok) {
  process.stderr.write(`browser: callback answered ${response.status}\n`);
  process.exit(1);
}
