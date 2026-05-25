import { supabase } from '@/lib/supabase'

export default async function Home() {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, name, status')
    .order('id')

  return (
    <main className="p-8 font-mono">
      <h1 className="text-2xl font-bold mb-4">DGLS — Supabase smoke test</h1>
      <pre className="bg-zinc-100 dark:bg-zinc-900 p-4 rounded text-sm overflow-auto">
        {JSON.stringify({ data, error }, null, 2)}
      </pre>
    </main>
  )
}
