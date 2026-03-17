import { DbConnection } from '../src/module_bindings';
import { Identity } from 'spacetimedb';

async function test() {
    const host = 'ws://localhost:9876';
    const dbName = 'obsidian-sync-backend';
    const token = 'MOCK_TOKEN';

    console.log(`Testing connection to ${host} for db ${dbName}...`);

    const builder = DbConnection.builder()
        .withUri(host)
        .withDatabaseName(dbName)
        .withCompression('none')
        .withWSFn(async (options) => {
            console.log('--- withWSFn hook ---');
            console.log('Options URL:', options.url.toString());
            console.log('DB Name:', options.nameOrAddress);

            // Use http(s) for URL construction to ensure standard resolution, then swap back to ws(s)
            const proto = options.url.protocol === 'wss:' ? 'https:' : 'http:';
            const baseUrl = `${proto}//${options.url.host}`;
            const finalUrl = new URL(`/v1/database/${options.nameOrAddress}/subscribe`, baseUrl);

            // Re-inject SDK parameters
            options.url.searchParams.forEach((value, key) => {
                finalUrl.searchParams.set(key, value);
            });

            finalUrl.searchParams.set('token', token);
            finalUrl.searchParams.set('compression', options.compression === 'gzip' ? 'Gzip' : 'None');

            const finalWsUrl = finalUrl.toString().replace(/^http/, 'ws');
            console.log('Final URL:', finalWsUrl);

            // In Node/Bun, we might need a WebSocket polyfill if not global
            const WS = (globalThis as any).WebSocket;
            if (!WS) {
                throw new Error('WebSocket not found in global scope. Use Bun or a polyfill.');
            }
            return new WS(finalWsUrl, options.wsProtocol);
        });

    builder.onConnect((conn, identity) => {
        console.log('SUCCESS: Connected!', identity.toHexString());
        conn.subscriptionBuilder().subscribeToAllTables();
    });

    builder.onConnectError((ctx, err) => {
        console.error('ERROR: Connection failed:', err);
        process.exit(1);
    });

    console.log('Building connection...');
    builder.build();
}

test().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
