'use client'

import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Просмотр аватара крупно (клик по аватарке в кабинете). Портал в body;
 * закрывается крестиком, Escape или кликом по фону. object-contain:
 * неквадратные картинки показываются целиком, кадрирует не браузер.
 */
export function AvatarLightbox({
  src,
  onClose,
}: {
  src: string
  onClose: () => void
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (!isMounted) {
    return null
  }

  return createPortal(
    <div
      className="avatar-lightbox-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Просмотр аватара"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="avatar-lightbox-card relative outline-none"
      >
        <img
          src={src}
          alt="Аватар"
          className="max-h-[82vh] max-w-[86vw] rounded-2xl border border-[#2A2A4A] object-contain shadow-2xl"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть просмотр аватара"
          className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur-md transition hover:scale-110 hover:text-white"
        >
          <X size={18} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
