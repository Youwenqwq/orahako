import { ScheduleCardItem, SCHEDULE_CARD_ROUTE } from './ScheduleWidgetData';

let storage = new LocalStorage();

@Entry(storage)
@Component
struct ScheduleCard {
  @LocalStorageProp('compact') compact: boolean = false;
  @LocalStorageProp('heading') heading: string = '今日课表';
  @LocalStorageProp('summary') summary: string = '';
  @LocalStorageProp('emptyText') emptyText: string = '打开应用同步课表';
  @LocalStorageProp('courses') courses: ScheduleCardItem[] = [];
  @LocalStorageProp('syncText') syncText: string = '';

  @Builder
  private courseCell(index: number) {
    Row({ space: 8 }) {
      Column()
        .width(3)
        .height('90%')
        .borderRadius(2)
        .backgroundColor(this.courses[index].color)
      Column({ space: 3 }) {
        Text(this.courses[index].title)
          .fontSize(this.compact ? 13 : 14)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.schedule_card_text'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.courses[index].detail)
          .fontSize(11)
          .fontColor($r('app.color.schedule_card_secondary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .height('100%')
    .layoutWeight(1)
    .padding({ left: 8, right: 8, top: 4, bottom: 4 })
    .borderRadius(11)
    .backgroundColor($r('app.color.schedule_card_tile'))
  }

  build() {
    Column({ space: this.compact ? 5 : 8 }) {
      Row() {
        Text(this.heading)
          .fontSize(this.compact ? 13 : 16)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.schedule_card_text'))
          .layoutWeight(1)
        Text(this.summary)
          .fontSize(this.compact ? 10 : 11)
          .maxLines(1)
          .fontColor($r('app.color.schedule_card_secondary'))
      }
      .width('100%')
      .padding({ left: 3, right: 3 })
      if (this.courses.length === 0) {
        Column() {
          Text(this.emptyText)
            .fontSize(13)
            .fontColor($r('app.color.schedule_card_secondary'))
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .borderRadius(11)
        .backgroundColor($r('app.color.schedule_card_tile'))
      } else if (this.compact) {
        Row() {
          this.courseCell(0)
        }
        .width('100%')
        .layoutWeight(1)
        if (this.courses.length > 1) {
          Row() {
            this.courseCell(1)
          }
          .width('100%')
          .layoutWeight(1)
        }
      } else {
        Row({ space: 8 }) {
          this.courseCell(0)
          if (this.courses.length > 1) {
            this.courseCell(1)
          }
        }
        .width('100%')
        .layoutWeight(1)
        if (this.courses.length > 2) {
          Row({ space: 8 }) {
            this.courseCell(2)
            if (this.courses.length > 3) {
              this.courseCell(3)
            } else {
              Blank().layoutWeight(1)
            }
          }
          .width('100%')
          .layoutWeight(1)
        }
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
        params: { destination: SCHEDULE_CARD_ROUTE }
      });
    })
  }
}
