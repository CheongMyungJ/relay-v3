// Astryx의 아이콘 이름에 없는 작은 그림(V78): 설정, 더하기, 넓히기, 브랜치, 꺾쇠, 경고. 선은 글자색을 따른다.
import type { ReactNode } from 'react'

function Svg({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const PlusIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
)

/** 설정: 손잡이 달린 줄 셋 */
export const SettingsIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M2.5 4.5h5M10.5 4.5h3M2.5 11.5h3M8.5 11.5h5" />
    <circle cx="9" cy="4.5" r="1.5" />
    <circle cx="7" cy="11.5" r="1.5" />
  </Svg>
)

/** 패널을 넓히기 */
export const ExpandIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
  </Svg>
)

/** 패널을 되돌리기 */
export const ShrinkIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M13 7H9V3M3 9h4v4M9 7l4.5-4.5M7 9l-4.5 4.5" />
  </Svg>
)

export const BranchIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-7 3" />
  </Svg>
)

export const ChevronIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </Svg>
)

export const WarnIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M8 2.2 14.3 13H1.7L8 2.2ZM8 6.5v3M8 11.3v.2" />
  </Svg>
)

/** relay의 표: 이어달리기의 바통 둘 */
export const RelayMark = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 11.5 7 4.5M9 11.5l4-7"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </svg>
)
