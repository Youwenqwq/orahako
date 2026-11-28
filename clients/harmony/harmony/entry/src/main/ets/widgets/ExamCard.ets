import { ExamCardItem, EXAM_CARD_ROUTE } from './ExamWidgetData';

let storage = new LocalStorage();

@Entry(storage)
@Component
struct ExamCard {
  @LocalStorageProp('compact') compact: boolean = false;
  @LocalStorageProp('summary') summary: string = '';
  @LocalStorageProp('emptyText') emptyText: string = '打开应用同步考试';
  @LocalStorageProp('exams') exams: ExamCardItem[] = [];
  @LocalStorageProp('syncText') syncText: string = '';

  @Builder
  private examRow(index: number) {
    Row({ space: 8 }) {
      Text(this.exams[index].time)
        .width(90)
        .fontSize(11)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.exam_card_accent'))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(this.exams[index].title)
        .layoutWeight(1)
        .fontSize(12)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.schedule_card_text'))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(this.exams[index].place)
        .constraintSize({ maxWidth: '34%' })
        .fontSize(10)
        .fontColor($r('app.color.schedule_card_secondary'))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .layoutWeight(1)
    .padding({ left: 7, right: 7 })
    .borderRadius(7)
    .backgroundColor($r('app.color.schedule_card_tile'))
  }

  build() {
    Column({ space: 5 }) {
      Row({ space: 5 }) {
        Text('考试通知')
          .layoutWeight(1)
          .maxLines(1)
          .fontSize(this.compact ? 13 : 16)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.schedule_card_text'))
        Text(this.summary)
          .fontSize(10)
          .fontColor($r('app.color.schedule_card_secondary'))
      }
      .width('100%')
      .padding({ left: 3, right: 3 })
      if (this.exams.length === 0) {
        Column() {
          Text(this.emptyText)
            .fontSize(13)
            .textAlign(TextAlign.Center)
            .fontColor($r('app.color.schedule_card_secondary'))
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .borderRadius(11)
        .backgroundColor($r('app.color.schedule_card_tile'))
      } else if (this.compact) {
        Column({ space: 4 }) {
          Text(this.exams[0].time)
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.exam_card_accent'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.exams[0].title)
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.schedule_card_text'))
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.exams[0].place)
            .fontSize(10)
            .fontColor($r('app.color.schedule_card_secondary'))
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .layoutWeight(1)
        .padding(8)
        .alignItems(HorizontalAlign.Start)
        .justifyContent(FlexAlign.Center)
        .borderRadius(11)
        .backgroundColor($r('app.color.schedule_card_tile'))
      } else {
        Column({ space: 4 }) {
          this.examRow(0)
          if (this.exams.length > 1) this.examRow(1)
          if (this.exams.length > 2) this.examRow(2)
        }
        .width('100%')
        .layoutWeight(1)
      }
      if (this.syncText) {
        Text(this.syncText)
          .fontSize(10)
          .fontColor($r('app.color.schedule_card_secondary'))
          .maxLines(1)
      }
    }
    .width('100%')
    .height('100%')
    .padding(10)
    .borderRadius(20)
    .backgroundColor($r('app.color.schedule_card_background'))
    .onClick(() => {
      postCardAction(this, {
        action: 'router',
        abilityName: 'EntryAbility',
        params: { destination: EXAM_CARD_ROUTE }
      });
    })
  }
}
