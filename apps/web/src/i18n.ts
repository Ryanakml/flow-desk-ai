export type InboxLocale = "en" | "id";

const messages = {
  en: {
    inbox: "Inbox",
    search: "Search phone or name...",
    queue: "Queue",
    allQueues: "All queues",
    assignee: "Assignee",
    allAssignees: "All Assignees",
    mine: "Assigned to Me",
    unassigned: "Unassigned",
    loading: "Loading conversations...",
    empty: "No conversations found",
    offline: "You are offline. Sending is paused until the connection returns.",
    reconnecting: "Reconnecting… Your inbox will refresh automatically.",
    conflict: "This conversation changed in another session.",
    reload: "Reload latest",
    note: "Private note",
    addNote: "Add note",
    notePlaceholder: "Visible only to your team…",
    tags: "Tags",
    filters: "Saved filters",
    saveFilter: "Save current filter",
    filterName: "Filter name",
    attach: "Attach media",
    scanning: "Scanning attachment…",
    send: "Send ↵",
    sending: "Sending...",
    retry: "Retry",
    remove: "Remove",
    language: "Bahasa Indonesia"
  },
  id: {
    inbox: "Kotak Masuk",
    search: "Cari nomor atau nama...",
    queue: "Antrean",
    allQueues: "Semua antrean",
    assignee: "Penanggung jawab",
    allAssignees: "Semua agen",
    mine: "Ditugaskan ke Saya",
    unassigned: "Belum ditugaskan",
    loading: "Memuat percakapan...",
    empty: "Percakapan tidak ditemukan",
    offline: "Kamu sedang offline. Pengiriman dijeda sampai koneksi kembali.",
    reconnecting: "Menyambungkan ulang… Kotak masuk akan dimuat ulang otomatis.",
    conflict: "Percakapan ini berubah di sesi lain.",
    reload: "Muat versi terbaru",
    note: "Catatan privat",
    addNote: "Tambah catatan",
    notePlaceholder: "Hanya terlihat oleh tim kamu…",
    tags: "Tag",
    filters: "Filter tersimpan",
    saveFilter: "Simpan filter saat ini",
    filterName: "Nama filter",
    attach: "Lampirkan media",
    scanning: "Memindai lampiran…",
    send: "Kirim ↵",
    sending: "Mengirim...",
    retry: "Coba lagi",
    remove: "Hapus",
    language: "English"
  }
} as const;

export function inboxMessages(locale: InboxLocale) {
  return messages[locale];
}
