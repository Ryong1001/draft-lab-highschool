"""웹 export 가 공유하는 스탯 엔진.

원래는 `streamlit_app/utils/` 에 있었다. 스트림릿 앱을 안 쓰게 된 뒤에도
export_*.py 열두 개가 이 세 모듈을 그대로 쓰고 있었는데, 정작 그 폴더는 별도
저장소(highschool_stats_detail)라 이 저장소 이력에 남지 않았다 — 웹의 계산
로직 전체가 "안 쓰는 앱" 폴더에 얹혀 백업도 안 되는 상태였다. 그래서 여기로
옮겼다.

세 모듈 모두 streamlit 을 import 하지 않는 순수 pandas 코드다:
  stats          — 타격/투구 집계, RE24, wOBA·wRC+ 등
  win_expectancy — 승리확률·WPA·상대전적
  pitch_limit    — 투구수 제한 판정
"""
