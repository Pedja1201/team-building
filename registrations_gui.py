"""Read-only desktop viewer. Run: python registrations_gui.py."""
import sqlite3
import tkinter as tk
from pathlib import Path
from tkinter import ttk

DATABASE = Path(__file__).resolve().parent / 'registrations.sqlite3'


def read_registrations():
    with sqlite3.connect(DATABASE.as_uri() + '?mode=ro', uri=True) as connection:
        return connection.execute(
            'SELECT email, registered_at FROM registrations '
            'ORDER BY registered_at DESC, id DESC'
        ).fetchall()


def main():
    root = tk.Tk()
    root.title('Evidencija prijava')
    root.geometry('820x500')
    root.minsize(560, 320)
    frame = ttk.Frame(root, padding=20)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='Evidencija prijava', font=('Segoe UI', 20, 'bold')).pack(anchor='w')
    ttk.Label(frame, text='Email adresa i vreme prve prijave (UTC)').pack(anchor='w', pady=(4, 16))

    toolbar = ttk.Frame(frame)
    toolbar.pack(fill='x', pady=(0, 12))
    ttk.Label(toolbar, text='Pretraga:').pack(side='left', padx=(0, 8))
    search = tk.StringVar()
    entry = ttk.Entry(toolbar, textvariable=search)
    entry.pack(side='left', fill='x', expand=True, padx=(0, 12))

    table_frame = ttk.Frame(frame)
    table_frame.pack(fill='both', expand=True)
    table = ttk.Treeview(table_frame, columns=('email', 'time'), show='headings')
    table.heading('email', text='Email adresa')
    table.heading('time', text='Prva prijava (UTC)')
    table.column('email', width=430, minwidth=200)
    table.column('time', width=210, minwidth=160)
    scrollbar = ttk.Scrollbar(table_frame, orient='vertical', command=table.yview)
    table.configure(yscrollcommand=scrollbar.set)
    scrollbar.pack(side='right', fill='y')
    table.pack(side='left', fill='both', expand=True)
    status = tk.StringVar()
    ttk.Label(frame, textvariable=status, wraplength=740).pack(anchor='w', pady=(12, 0))
    rows = []
    error = None

    def render(*_):
        children = table.get_children()
        if children:
            table.delete(*children)
        query = search.get().strip().casefold()
        visible = [row for row in rows if query in row[0].casefold()]
        for row in visible:
            table.insert('', 'end', values=row)
        status.set(error or (
            f'Prikazano: {len(visible)} / Ukupno prijava: {len(rows)}'
            if rows else 'Nema prijava.'
        ))

    def refresh():
        nonlocal rows, error
        try:
            rows = read_registrations()
            error = None
        except sqlite3.Error as exc:
            rows = []
            error = ('Baza još ne postoji. Pokreni python server.py, pa klikni Osveži.'
                     if not DATABASE.exists() else f'Baza nije dostupna: {exc}')
        render()

    ttk.Button(toolbar, text='Osveži', command=refresh).pack(side='right')
    search.trace_add('write', render)
    root.bind('<F5>', lambda _: refresh())
    refresh()
    entry.focus_set()
    root.mainloop()


if __name__ == '__main__':
    main()
