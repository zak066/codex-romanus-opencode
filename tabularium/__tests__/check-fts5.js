try {
  const D = require('better-sqlite3');
  const d = new D(':memory:');
  d.exec('CREATE VIRTUAL TABLE IF NOT EXISTS test_fts USING fts5(content)');
  d.exec("INSERT INTO test_fts VALUES ('hello world')");
  const r = d.prepare('SELECT * FROM test_fts WHERE test_fts MATCH ?').all('hello');
  console.log('FTS5 SUPPORTED:', JSON.stringify(r));
  d.close();
} catch(e) {
  console.log('FTS5 ERROR:', e.message);
}
