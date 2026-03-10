'use client'

import dynamic from 'next/dynamic'

const FileManagerClient = dynamic(() => import('./FileManagerClient'), {
  ssr: false
})

export default function FileManagerClientNoSSR(props) {
  return <FileManagerClient {...props} />
}

