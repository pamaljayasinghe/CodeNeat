import os,sys
from typing import  Optional
DEFAULTS={'retries':3,'timeout':1.5,'verbose':False}
class Config:
  def __init__(self,path:str,overrides:Optional[dict]=None):
      self.path=path;self.values={**DEFAULTS,**(overrides or {})}
  def describe(self,prefix='config',include_path=True,separator=', '):
        parts=[f'{key}={value!r}' for key,value in sorted(self.values.items()) if value is not None and not key.startswith('_')]
        return prefix+': '+separator.join(parts)+(' ('+self.path+')' if include_path else '')
def main( argv = None ):
    config=Config(os.path.join(os.getcwd(),"settings.json"),{"verbose":True,})
    print(config.describe())
    return 0
if __name__=="__main__":sys.exit(main())
