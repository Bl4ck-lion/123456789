import Head from 'next/head';
import dynamic from 'next/dynamic';
import Chat from '../components/Chat';

export default function Home(){
  return (
    <>
      <Head>
        <title>Secure Chat (Vercel frontend)</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main style={{ padding: 24 }}>
        <h1>Secure Chat — Frontend (Vercel)</h1>
        <Chat />
      </main>
    </>
  );
}
