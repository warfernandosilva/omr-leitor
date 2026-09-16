import { Document, Page, Image, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 0, backgroundColor: '#ffffff' },
  image: { width: '100%', height: '100%', objectFit: 'fill' },
});

interface Props {
  pngUrl: string;
  title?: string;
}

export default function CardPdfDocument({ pngUrl, title }: Props) {
  return (
    <Document title={title ?? 'Cartao-resposta OMR'} author="OMR">
      <Page size="A4" orientation="portrait" style={styles.page}>
        <Image src={pngUrl} style={styles.image} />
      </Page>
    </Document>
  );
}
